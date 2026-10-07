import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { writeImportedTicket, importedCategoryId, type ImportedQa } from "@/lib/imports/write";
import { closeOcr } from "@/lib/ocr/tesseract";

const A = "it-3b-write";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);
const IC_RE = /\d{6}[\s-]?\d{2}[\s-]?\d{4}/;
let dir: string;
let projectId: string;

const png = () => sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toBuffer();

function qa(overrides: Partial<ImportedQa>): ImportedQa {
  return {
    importKey: `wa:${Math.random()}`,
    projectId,
    source: "whatsapp_export",
    client: { name: "Ali Ahmad" },
    messages: [],
    status: "closed",
    ...overrides,
  };
}

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "Write", slug: A } });
  projectId = (await asA(() => prisma.project.create({ data: { name: "General", isDefault: true } }))).id;
  dir = mkdtempSync(path.join(tmpdir(), "helplus-import-write-"));
  process.env.HELPLUS_STORAGE_DIR = dir;
});

afterAll(async () => {
  await closeOcr();
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("writeImportedTicket", () => {
  it("masks ICs and sets dates from the message times", async () => {
    const first = new Date("2026-01-01T09:00:00Z");
    const reply = new Date("2026-01-01T09:30:00Z");
    const last = new Date("2026-01-01T09:35:00Z");
    const q = qa({
      status: "closed",
      client: { name: "Ali Ahmad", contact: "my IC is 900101-14-5678" },
      messages: [
        { role: "customer", text: "my IC is 900101-14-5678 please help", at: first, importKey: "wa:m1" },
        { role: "agent", text: "sure, noted IC 900101-14-5678", at: reply, importKey: "wa:m2" },
        { role: "customer", text: "thanks!", at: last, importKey: "wa:m3" },
      ],
    });
    const result = await asA(() => writeImportedTicket(q));
    expect(result.created).toBe(true);
    const ticket = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: result.ticketId! } }));
    expect(ticket.source).toBe("whatsapp_export");
    expect(ticket.importKey).toBe(q.importKey);
    expect(ticket.createdAt).toEqual(first);
    expect(ticket.answeredAt).toEqual(reply);
    expect(ticket.firstReplyAt).toEqual(reply);
    expect(ticket.closedAt).toEqual(last);
    expect(ticket.resolveDueAt).toBeNull();
    expect(ticket.status).toBe("closed");
    expect(ticket.title).not.toMatch(IC_RE);
    expect(ticket.description).toContain("[IC HIDDEN]");
    expect(ticket.description).not.toMatch(IC_RE);
    const msgs = await asA(() =>
      prisma.message.findMany({ where: { conversationId: ticket.conversationId! }, orderBy: { createdAt: "asc" } })
    );
    expect(msgs).toHaveLength(3);
    for (const m of msgs) {
      expect(m.content).not.toMatch(IC_RE);
      expect(m.importKey).not.toBeNull();
    }
    expect(msgs[1].content).toContain("[IC HIDDEN]");

    const conv = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: ticket.conversationId! } }));
    expect(conv.customerName).not.toMatch(IC_RE);
    expect(conv.customerContact).not.toMatch(IC_RE);
    expect(conv.customerContact).toContain("[IC HIDDEN]");
  });

  it("queues no emails even for an admin with notifyNew", async () => {
    await asA(() =>
      prisma.admin.create({
        data: { id: "it-3b-write-admin", username: "it-3b-write-admin", password: "x", email: "boss@write.test", notifyNew: true },
      })
    );
    const q = qa({
      messages: [
        { role: "customer", text: "printer down", at: new Date("2026-01-02T00:00:00Z") },
        { role: "agent", text: "restarted it", at: new Date("2026-01-02T00:05:00Z") },
      ],
    });
    const result = await asA(() => writeImportedTicket(q));
    const emails = await asA(() => prisma.emailOutbox.findMany({ where: { ticketId: result.ticketId } }));
    expect(emails).toHaveLength(0);
  });

  it("creates a draft library entry with masked Q&A content", async () => {
    const q = qa({
      messages: [
        { role: "customer", text: "how do I reset my IC 900101-14-5678 login", at: new Date("2026-01-03T00:00:00Z") },
        { role: "agent", text: "click forgot password", at: new Date("2026-01-03T00:05:00Z") },
      ],
    });
    const result = await asA(() => writeImportedTicket(q));
    expect(result.draftId).toBeTruthy();
    const draft = await asA(() => prisma.knowledgeEntry.findUniqueOrThrow({ where: { id: result.draftId! } }));
    expect(draft.status).toBe("draft");
    expect(draft.isActive).toBe(false);
    expect(draft.projectId).toBe(projectId);
    expect(draft.sourceTicketId).toBe(result.ticketId);
    expect(draft.content.startsWith("Q: ")).toBe(true);
    expect(draft.content).toContain("\n\nA: ");
    expect(draft.content).not.toMatch(IC_RE);
    const cat = await asA(() => prisma.category.findUniqueOrThrow({ where: { id: draft.categoryId } }));
    expect(cat.name).toBe("Imported");
    expect(await asA(() => importedCategoryId())).toBe(cat.id);
  });

  it("skips a re-import of the same ticket import key", async () => {
    const q = qa({
      importKey: "wa:reimport-1",
      messages: [{ role: "customer", text: "hello", at: new Date("2026-01-04T00:00:00Z") }],
      status: "new",
    });
    const first = await asA(() => writeImportedTicket(q));
    expect(first.created).toBe(true);
    const second = await asA(() => writeImportedTicket(q));
    expect(second.created).toBe(false);
    expect(second.ticketId).toBe(first.ticketId);
    const count = await asA(() => prisma.ticket.count({ where: { importKey: "wa:reimport-1" } }));
    expect(count).toBe(1);
    // the one message it had has no import key, so a no-op repair must not duplicate it
    const ticket = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: first.ticketId! } }));
    const msgs = await asA(() => prisma.message.findMany({ where: { conversationId: ticket.conversationId! } }));
    expect(msgs).toHaveLength(1);
  });

  it("leaves no orphan ticket or conversation when two imports race on the same key", async () => {
    const q = qa({
      importKey: "wa:race-1",
      messages: [{ role: "customer", text: "racey", at: new Date("2026-01-04T12:00:00Z") }],
      status: "new",
    });
    const [a, b] = await Promise.all([asA(() => writeImportedTicket(q)), asA(() => writeImportedTicket(q))]);
    const created = [a, b].filter((r) => r.created);
    expect(created).toHaveLength(1);
    const tickets = await asA(() => prisma.ticket.count({ where: { importKey: "wa:race-1" } }));
    expect(tickets).toBe(1);
    // the loser's conversation (and its message, by cascade) must be cleaned up, not left orphaned
    const racey = await asA(() => prisma.message.findMany({ where: { content: "racey" } }));
    expect(racey).toHaveLength(1);
  });

  it("keeps all the winning ticket's messages when two imports race with import-keyed messages", async () => {
    const q = qa({
      importKey: "wa:race-msgs-1",
      status: "new",
      messages: [
        { role: "customer", text: "first", at: new Date("2026-01-15T00:00:00Z"), importKey: "wa:race-msgs-1-a" },
        { role: "customer", text: "second", at: new Date("2026-01-15T00:01:00Z"), importKey: "wa:race-msgs-1-b" },
      ],
    });
    const [a, b] = await Promise.all([asA(() => writeImportedTicket(q)), asA(() => writeImportedTicket(q))]);
    const winner = [a, b].find((r) => r.created);
    expect(winner).toBeTruthy();
    const ticket = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: winner!.ticketId! } }));
    const msgs = await asA(() => prisma.message.findMany({ where: { conversationId: ticket.conversationId! } }));
    expect(msgs).toHaveLength(2);
  });

  it("rethrows a ticket number collision that isn't a real import key race, after cleanup", async () => {
    const counter = await asA(() => prisma.ticketCounter.findFirstOrThrow());
    const collideNumber = counter.next;
    await asA(() => prisma.ticket.create({ data: { number: collideNumber, title: "decoy", description: "", projectId } }));
    // put the counter back so nextTicketNumber() hands out the same, already-taken number
    await asA(() => prisma.ticketCounter.update({ where: { companyId: A }, data: { next: collideNumber } }));

    const q = qa({
      importKey: "wa:collide-1",
      messages: [{ role: "customer", text: "collide me", at: new Date("2026-01-16T00:00:00Z") }],
      status: "new",
    });
    await expect(asA(() => writeImportedTicket(q))).rejects.toMatchObject({ code: "P2002" });

    const ticketWithKey = await asA(() => prisma.ticket.findFirst({ where: { importKey: "wa:collide-1" } }));
    expect(ticketWithKey).toBeNull();
    const orphanMsgs = await asA(() => prisma.message.findMany({ where: { content: "collide me" } }));
    expect(orphanMsgs).toHaveLength(0);
  });

  it("creates an open ticket with no draft for an unanswered, still-fresh chat", async () => {
    const q = qa({
      status: "new",
      messages: [{ role: "customer", text: "anyone there?", at: new Date("2026-01-05T00:00:00Z") }],
    });
    const result = await asA(() => writeImportedTicket(q));
    expect(result.draftId).toBeUndefined();
    const ticket = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: result.ticketId! } }));
    expect(ticket.status).toBe("new");
    expect(ticket.closedAt).toBeNull();
    expect(ticket.firstReplyAt).toBeNull();
  });

  it("closes an unanswered chat with a masked internal note when marked closed", async () => {
    const q = qa({
      status: "closed",
      closeNote: "No reply in the imported chat. IC on file: 900101-14-5678",
      messages: [{ role: "customer", text: "anyone there?", at: new Date("2026-01-06T00:00:00Z") }],
    });
    const result = await asA(() => writeImportedTicket(q));
    const ticket = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: result.ticketId! } }));
    expect(ticket.status).toBe("closed");
    expect(ticket.firstReplyAt).toBeNull();
    const notes = await asA(() => prisma.internalNote.findMany({ where: { conversationId: ticket.conversationId! } }));
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toContain("[IC HIDDEN]");
    expect(notes[0].content).not.toMatch(IC_RE);
  });

  it("finds or creates one customer by phone-like name and sets its project", async () => {
    const name = "+60 12-345 6789";
    const q1 = qa({
      client: { name },
      messages: [{ role: "customer", text: "hi", at: new Date("2026-01-07T00:00:00Z") }],
      status: "new",
    });
    const r1 = await asA(() => writeImportedTicket(q1));
    const t1 = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: r1.ticketId! } }));
    const conv1 = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: t1.conversationId! } }));
    expect(conv1.customerId).toBeTruthy();
    const customer = await asA(() => prisma.customer.findUniqueOrThrow({ where: { id: conv1.customerId! } }));
    expect(customer.phone).toBe("60123456789");
    expect(customer.projectId).toBe(projectId);

    const q2 = qa({
      client: { name },
      messages: [{ role: "customer", text: "hi again", at: new Date("2026-01-07T01:00:00Z") }],
      status: "new",
    });
    const r2 = await asA(() => writeImportedTicket(q2));
    const t2 = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: r2.ticketId! } }));
    const conv2 = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: t2.conversationId! } }));
    expect(conv2.customerId).toBe(conv1.customerId);
  });

  it("normalises a leading 0 to 60 so a local and an intl number match the same customer", async () => {
    const q1 = qa({
      client: { name: "012-999 1111" },
      messages: [{ role: "customer", text: "hi", at: new Date("2026-01-10T00:00:00Z") }],
      status: "new",
    });
    const r1 = await asA(() => writeImportedTicket(q1));
    const t1 = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: r1.ticketId! } }));
    const conv1 = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: t1.conversationId! } }));
    const customer1 = await asA(() => prisma.customer.findUniqueOrThrow({ where: { id: conv1.customerId! } }));
    expect(customer1.phone).toBe("60129991111");

    const q2 = qa({
      client: { name: "+60 12-999 1111" },
      messages: [{ role: "customer", text: "hi again", at: new Date("2026-01-10T01:00:00Z") }],
      status: "new",
    });
    const r2 = await asA(() => writeImportedTicket(q2));
    const t2 = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: r2.ticketId! } }));
    const conv2 = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: t2.conversationId! } }));
    expect(conv2.customerId).toBe(conv1.customerId);
  });

  it("never stores an IC that looks like a phone number in Customer.phone", async () => {
    const q = qa({
      client: { name: "Caller", contact: "900101-14-5678" },
      messages: [{ role: "customer", text: "hi", at: new Date("2026-01-09T00:00:00Z") }],
      status: "new",
    });
    const result = await asA(() => writeImportedTicket(q));
    const ticket = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: result.ticketId! } }));
    const conv = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: ticket.conversationId! } }));
    expect(conv.customerContact).not.toMatch(IC_RE);
    expect(conv.customerContact).toContain("[IC HIDDEN]");
    const customer = await asA(() => prisma.customer.findUniqueOrThrow({ where: { id: conv.customerId! } }));
    expect(customer.phone).toBe("");
    expect(customer.name).not.toMatch(IC_RE);
  });

  it("fills in a phone match's missing project instead of creating a new customer", async () => {
    const existing = await asA(() => prisma.customer.create({ data: { name: "No Project Yet", phone: "60112223333" } }));
    expect(existing.projectId).toBeNull();
    const q = qa({
      client: { name: "011-222 3333" }, // normalises to the same phone as `existing`
      messages: [{ role: "customer", text: "hi", at: new Date("2026-01-11T00:00:00Z") }],
      status: "new",
    });
    const result = await asA(() => writeImportedTicket(q));
    const ticket = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: result.ticketId! } }));
    const conv = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: ticket.conversationId! } }));
    expect(conv.customerId).toBe(existing.id);
    const after = await asA(() => prisma.customer.findUniqueOrThrow({ where: { id: existing.id } }));
    expect(after.projectId).toBe(projectId);
  });

  it("reuses a name-only match within the same project but not a different one", async () => {
    const name = "Siti Aminah";
    const q1 = qa({
      client: { name },
      messages: [{ role: "customer", text: "hi", at: new Date("2026-01-12T00:00:00Z") }],
      status: "new",
    });
    const r1 = await asA(() => writeImportedTicket(q1));
    const t1 = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: r1.ticketId! } }));
    const conv1 = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: t1.conversationId! } }));

    const q2 = qa({
      client: { name },
      messages: [{ role: "customer", text: "hi again", at: new Date("2026-01-12T01:00:00Z") }],
      status: "new",
    });
    const r2 = await asA(() => writeImportedTicket(q2));
    const t2 = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: r2.ticketId! } }));
    const conv2 = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: t2.conversationId! } }));
    expect(conv2.customerId).toBe(conv1.customerId);

    const otherProjectId = (await asA(() => prisma.project.create({ data: { name: "Other" } }))).id;
    const q3 = qa({
      projectId: otherProjectId,
      client: { name },
      messages: [{ role: "customer", text: "hi from another project", at: new Date("2026-01-12T02:00:00Z") }],
      status: "new",
    });
    const r3 = await asA(() => writeImportedTicket(q3));
    const t3 = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: r3.ticketId! } }));
    const conv3 = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: t3.conversationId! } }));
    expect(conv3.customerId).not.toBe(conv1.customerId);
  });

  it("never reuses a customer for a placeholder name", async () => {
    const q1 = qa({
      client: { name: "" },
      messages: [{ role: "customer", text: "hi", at: new Date("2026-01-13T00:00:00Z") }],
      status: "new",
    });
    const r1 = await asA(() => writeImportedTicket(q1));
    const t1 = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: r1.ticketId! } }));
    const conv1 = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: t1.conversationId! } }));
    const customer1 = await asA(() => prisma.customer.findUniqueOrThrow({ where: { id: conv1.customerId! } }));
    expect(customer1.name).toBe("Unknown");

    const q2 = qa({
      client: { name: "" },
      messages: [{ role: "customer", text: "hi again", at: new Date("2026-01-13T01:00:00Z") }],
      status: "new",
    });
    const r2 = await asA(() => writeImportedTicket(q2));
    const t2 = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: r2.ticketId! } }));
    const conv2 = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: t2.conversationId! } }));
    expect(conv2.customerId).not.toBe(conv1.customerId);
  });

  it("stores an allowed image as a pending attachment linked to its message and skips a non-image", async () => {
    const q = qa({
      status: "closed",
      messages: [
        { role: "customer", text: "see this", at: new Date("2026-01-08T00:00:00Z") },
        { role: "agent", text: "got it, here's a screenshot", at: new Date("2026-01-08T00:05:00Z") },
      ],
      images: [
        { fileName: "shot.png", data: await png(), messageIndex: 1 },
        { fileName: "voice.ogg", data: Buffer.from("not an image"), messageIndex: 0 },
      ],
    });
    const result = await asA(() => writeImportedTicket(q));
    expect(result.images).toBe(1);
    expect(result.skippedImages).toBe(1);
    const ticket = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: result.ticketId! } }));
    const msgs = await asA(() =>
      prisma.message.findMany({ where: { conversationId: ticket.conversationId! }, orderBy: { createdAt: "asc" } })
    );
    const attachments = await asA(() => prisma.attachment.findMany({ where: { ticketId: ticket.id } }));
    expect(attachments).toHaveLength(1);
    expect(attachments[0].status).toBe("pending");
    expect(attachments[0].messageId).toBe(msgs[1].id);
  });

  it("attaches an image to the right message even when messages arrive out of order", async () => {
    const earlier = new Date("2026-01-14T00:00:00Z");
    const later = new Date("2026-01-14T00:05:00Z");
    const q = qa({
      status: "closed",
      // input order is reversed: index 0 is actually the later message
      messages: [
        { role: "agent", text: "got it, here's a screenshot", at: later },
        { role: "customer", text: "see this", at: earlier },
      ],
      images: [{ fileName: "shot.png", data: await png(), messageIndex: 0 }],
    });
    const result = await asA(() => writeImportedTicket(q));
    expect(result.images).toBe(1);
    const ticket = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: result.ticketId! } }));
    const laterMsg = await asA(() =>
      prisma.message.findFirstOrThrow({ where: { conversationId: ticket.conversationId!, createdAt: later } })
    );
    const attachments = await asA(() => prisma.attachment.findMany({ where: { ticketId: ticket.id } }));
    expect(attachments).toHaveLength(1);
    expect(attachments[0].messageId).toBe(laterMsg.id);
  });

  it("repairs a crashed partial write: a re-run fills in the messages, the draft and the note", async () => {
    const q = qa({
      importKey: "wa:crash-1",
      status: "closed",
      closeNote: "handled it",
      messages: [
        { role: "customer", text: "need help", at: new Date("2026-01-17T00:00:00Z"), importKey: "wa:crash-1-a" },
        { role: "agent", text: "here you go", at: new Date("2026-01-17T00:05:00Z"), importKey: "wa:crash-1-b" },
      ],
    });
    const first = await asA(() => writeImportedTicket(q));
    expect(first.created).toBe(true);
    const ticketId = first.ticketId!;
    const ticket = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } }));
    // simulate a crash that got the ticket and conversation written, but nothing else
    await asA(() => prisma.message.deleteMany({ where: { conversationId: ticket.conversationId! } }));
    await asA(() => prisma.internalNote.deleteMany({ where: { conversationId: ticket.conversationId! } }));
    await asA(() => prisma.knowledgeEntry.deleteMany({ where: { sourceTicketId: ticketId } }));

    const repaired = await asA(() => writeImportedTicket(q));
    expect(repaired.created).toBe(false);
    expect(repaired.ticketId).toBe(ticketId);
    const msgs = await asA(() => prisma.message.findMany({ where: { conversationId: ticket.conversationId! } }));
    expect(msgs).toHaveLength(2);
    const notes = await asA(() => prisma.internalNote.findMany({ where: { conversationId: ticket.conversationId! } }));
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toBe("handled it");
    const draft = await asA(() => prisma.knowledgeEntry.findFirst({ where: { sourceTicketId: ticketId } }));
    expect(draft).toBeTruthy();

    // a second re-run is a no-op
    const again = await asA(() => writeImportedTicket(q));
    expect(again.created).toBe(false);
    expect(again.ticketId).toBe(ticketId);
    const msgsAgain = await asA(() => prisma.message.findMany({ where: { conversationId: ticket.conversationId! } }));
    expect(msgsAgain).toHaveLength(2);
    const notesAgain = await asA(() => prisma.internalNote.findMany({ where: { conversationId: ticket.conversationId! } }));
    expect(notesAgain).toHaveLength(1);
    const draftsAgain = await asA(() => prisma.knowledgeEntry.findMany({ where: { sourceTicketId: ticketId } }));
    expect(draftsAgain).toHaveLength(1);
  });

  it("treats a bare 12-digit run as IC-shaped and never stores it as a phone (safe side)", async () => {
    // "+601123456789" reads as a valid intl number too, but 12 contiguous digits also match
    // the IC shape, and refusing to store a possible IC beats catching every real phone number
    const q = qa({
      client: { name: "+601123456789" },
      messages: [{ role: "customer", text: "hi", at: new Date("2026-01-18T00:00:00Z") }],
      status: "new",
    });
    const result = await asA(() => writeImportedTicket(q));
    const ticket = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: result.ticketId! } }));
    const conv = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: ticket.conversationId! } }));
    const customer = await asA(() => prisma.customer.findUniqueOrThrow({ where: { id: conv.customerId! } }));
    expect(customer.phone).toBe("");
  });
});
