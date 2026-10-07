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
    expect(ticket.title).not.toMatch(/\d{6}[\s-]?\d{2}[\s-]?\d{4}/);
    expect(ticket.description).toContain("[IC HIDDEN]");
    expect(ticket.description).not.toMatch(/\d{6}[\s-]?\d{2}[\s-]?\d{4}/);
    const msgs = await asA(() =>
      prisma.message.findMany({ where: { conversationId: ticket.conversationId! }, orderBy: { createdAt: "asc" } })
    );
    expect(msgs).toHaveLength(3);
    for (const m of msgs) {
      expect(m.content).not.toMatch(/\d{6}[\s-]?\d{2}[\s-]?\d{4}/);
      expect(m.importKey).not.toBeNull();
    }
    expect(msgs[1].content).toContain("[IC HIDDEN]");
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
    expect(draft.content).not.toMatch(/\d{6}[\s-]?\d{2}[\s-]?\d{4}/);
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
    expect(second).toEqual({ created: false, images: 0, skippedImages: 0 });
    const count = await asA(() => prisma.ticket.count({ where: { importKey: "wa:reimport-1" } }));
    expect(count).toBe(1);
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

  it("closes an unanswered chat with an internal note when marked closed", async () => {
    const q = qa({
      status: "closed",
      closeNote: "No reply in the imported chat",
      messages: [{ role: "customer", text: "anyone there?", at: new Date("2026-01-06T00:00:00Z") }],
    });
    const result = await asA(() => writeImportedTicket(q));
    const ticket = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: result.ticketId! } }));
    expect(ticket.status).toBe("closed");
    expect(ticket.firstReplyAt).toBeNull();
    const notes = await asA(() => prisma.internalNote.findMany({ where: { conversationId: ticket.conversationId! } }));
    expect(notes.map((n) => n.content)).toEqual(["No reply in the imported chat"]);
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
});
