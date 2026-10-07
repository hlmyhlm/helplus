import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { defaultProjectId } from "@/lib/projects/default";
import { recordInbound, type IncomingEvent } from "@/lib/bot/record";
import { runBotIntake, placeReply, cleanBotInbound } from "@/lib/bot/intake";
import { closeOcr } from "@/lib/ocr/tesseract";
import { runPendingAttachments } from "@/lib/jobs/attachments";
import { logger } from "@/lib/logger";

// real code, but a test can make one sender or the next openTicket fail
const fail = vi.hoisted(() => ({ senders: new Set<string>(), openTicket: 0, onOpen: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/customer-resolver", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/customer-resolver")>();
  return {
    ...real,
    resolveCustomer: vi.fn(async (channel: string, contact: string, name: string) => {
      if (fail.senders.has(name)) throw new Error("resolve failed");
      return real.resolveCustomer(channel, contact, name);
    }),
  };
});
vi.mock("@/lib/tickets/service", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/tickets/service")>();
  return {
    ...real,
    openTicket: vi.fn(async (input: Parameters<typeof real.openTicket>[0]) => {
      if (fail.openTicket > 0) {
        fail.openTicket--;
        throw new Error("open failed");
      }
      await fail.onOpen?.();
      return real.openTicket(input);
    }),
  };
});

const ids = Array.from({ length: 30 }, (_, i) => `it-3c-in-${i + 1}`);
let dir: string;

const T = new Date("2026-10-11T02:00:00Z");
const H = 3600_000;
const min = (n: number) => new Date(T.getTime() + n * 60_000);
let n = 0;
const ev = (over: Partial<IncomingEvent>): IncomingEvent => ({
  waMessageId: `m${++n}`, chatWaId: "120@g.us", chatName: "Kedai", isGroup: true,
  senderId: "60199999999@c.us", senderName: "Aminah", text: "hello", at: T, quotedWaId: null, media: null, ...over,
});
const staff = { senderId: "60188888888@c.us", senderName: "Support Ali" };
const siti = { senderId: "60177777777@c.us", senderName: "Siti" };
const png = () =>
  sharp({ create: { width: 400, height: 160, channels: 3, background: "#ffffff" } }).withMetadata({ density: 300 }).png().toBuffer();

async function makeCompany(name: string): Promise<string> {
  const id = `it-3c-${name}`;
  await systemPrisma.company.create({ data: { id, name: id, slug: id } });
  await runWithCompany(id, () => defaultProjectId());
  return id;
}

async function setup(name: string) {
  const co = await makeCompany(name);
  await runWithCompany(co, async () => {
    const project = await prisma.project.findFirstOrThrow();
    await prisma.waChat.create({ data: { waId: "120@g.us", name: "Kedai", projectId: project.id } });
    await prisma.chatSender.create({ data: { name: "Support Ali", isStaff: true } });
    await prisma.sLARule.create({ data: { name: "Default" } });
  });
  return co;
}

beforeEach(() => {
  fail.senders.clear();
  fail.openTicket = 0;
  fail.onOpen = null;
});

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: ids } } });
  dir = mkdtempSync(path.join(tmpdir(), "helplus-bot-intake-"));
  process.env.HELPLUS_STORAGE_DIR = dir;
});

afterAll(async () => {
  await closeOcr();
  await systemPrisma.company.deleteMany({ where: { id: { in: ids } } });
  await systemPrisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("runBotIntake", () => {
  it("waits 2 quiet minutes, then opens one ticket with both messages", async () => {
    await runWithCompany(await setup("in-1"), async () => {
      await recordInbound(ev({ text: "printer rosak", at: min(0) }), "");
      await recordInbound(ev({ text: "dah restart", at: min(1) }), "");
      expect((await runBotIntake(min(2))).tickets).toBe(0);
      expect((await runBotIntake(min(3))).tickets).toBe(1);
      const t = await prisma.ticket.findFirstOrThrow({
        include: { conversation: { include: { messages: { orderBy: { createdAt: "asc" } } } } },
      });
      expect(t.source).toBe("whatsapp_group");
      expect(t.conversation!.messages.map((m) => m.content)).toEqual(["printer rosak", "dah restart"]);
      expect(t.conversation!.customerContact).toBe("60199999999");
      expect(t.firstReplyDueAt).toBeTruthy();
      const customer = await prisma.customer.findFirstOrThrow();
      expect(customer.whatsapp).toBe("60199999999");
      expect(customer.projectId).toBe(t.projectId);
    });
  });

  it("a quoted staff reply answers that ticket", async () => {
    await runWithCompany(await setup("in-2"), async () => {
      await recordInbound(ev({ waMessageId: "q1", text: "printer rosak", at: min(0) }), "");
      await runBotIntake(min(3));
      await recordInbound(ev({ ...staff, text: "cuba tukar kabel", at: min(4), quotedWaId: "q1" }), "");
      expect((await runBotIntake(min(4))).answers).toBe(1);
      const t = await prisma.ticket.findFirstOrThrow();
      expect(t.status).toBe("answered");
      expect(t.firstReplyAt).not.toBeNull();
      expect(await prisma.message.count({ where: { role: "agent", conversationId: t.conversationId! } })).toBe(1);
    });
  });

  it("a staff reply right after the question still lands after the ticket exists", async () => {
    await runWithCompany(await setup("in-3"), async () => {
      await recordInbound(ev({ text: "boleh tolong?", at: min(0) }), "");
      await recordInbound(ev({ ...staff, text: "ok", at: min(0.5) }), "");
      const r = await runBotIntake(min(1));
      expect(r).toMatchObject({ tickets: 1, answers: 1 });
    });
  });

  it("an unquoted reply with two open tickets waits for staff to place it", async () => {
    await runWithCompany(await setup("in-4"), async () => {
      await recordInbound(ev({ text: "a", at: min(0) }), "");
      await recordInbound(ev({ ...siti, text: "b", at: min(0) }), "");
      await runBotIntake(min(3));
      await recordInbound(ev({ ...staff, text: "done", at: min(4) }), "");
      expect((await runBotIntake(min(4))).picks).toBe(1);
      const pick = await prisma.waInbound.findFirstOrThrow({ where: { state: "pick" } });
      const ticket = await prisma.ticket.findFirstOrThrow();
      expect(await placeReply(pick.id, ticket.id)).toBe("placed");
      expect(await placeReply(pick.id, ticket.id)).toBe("gone");
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("answered");
    });
  });

  it("placing refuses a ticket from another chat and can ignore a reply", async () => {
    await runWithCompany(await setup("in-8"), async () => {
      await recordInbound(ev({ text: "a", at: min(0) }), "");
      await recordInbound(ev({ ...siti, text: "b", at: min(0) }), "");
      await runBotIntake(min(3));
      await recordInbound(ev({ ...staff, text: "done", at: min(4) }), "");
      await runBotIntake(min(4));
      const pick = await prisma.waInbound.findFirstOrThrow({ where: { state: "pick" } });
      const other = await prisma.ticket.create({
        data: { number: 999, title: "x", description: "x", projectId: (await prisma.project.findFirstOrThrow()).id },
      });
      expect(await placeReply(pick.id, other.id)).toBe("gone");
      expect((await prisma.waInbound.findUniqueOrThrow({ where: { id: pick.id } })).state).toBe("pick");
      expect(await placeReply(pick.id, null)).toBe("ignored");
      const row = await prisma.waInbound.findUniqueOrThrow({ where: { id: pick.id } });
      expect(row.state).toBe("ignored");
      expect(row.doneAt).not.toBeNull();
    });
  });

  it("a client follow-up after an answer moves the ticket back to working", async () => {
    await runWithCompany(await setup("in-5"), async () => {
      await recordInbound(ev({ waMessageId: "q", text: "x", at: min(0) }), "");
      await runBotIntake(min(3));
      await recordInbound(ev({ ...staff, text: "fixed", at: min(4), quotedWaId: "q" }), "");
      await runBotIntake(min(4));
      await recordInbound(ev({ text: "masih rosak", at: min(10) }), "");
      await runBotIntake(min(13));
      expect(await prisma.ticket.count()).toBe(1);
      expect((await prisma.ticket.findFirstOrThrow()).status).toBe("working");
    });
  });

  it("running twice never makes a second ticket", async () => {
    await runWithCompany(await setup("in-6"), async () => {
      await recordInbound(ev({ text: "x", at: min(0) }), "");
      await runBotIntake(min(3));
      await prisma.waInbound.updateMany({ data: { state: "pending" } }); // as if the run died before marking
      await runBotIntake(min(3));
      expect(await prisma.ticket.count()).toBe(1);
      expect(await prisma.message.count()).toBe(1);
      expect(await prisma.waInbound.count({ where: { state: "done" } })).toBe(1);
    });
  });

  it("cleans old done rows", async () => {
    await runWithCompany(await setup("in-7"), async () => {
      await recordInbound(ev({ text: "x", at: min(0) }), "");
      await runBotIntake(min(3));
      expect(await cleanBotInbound(new Date(min(3).getTime() + 8 * 86_400_000))).toBe(1);
      expect(await prisma.waInbound.count()).toBe(0);
    });
  });

  it("attaches a stored image to the ticket and drops the stored copy", { timeout: 120_000 }, async () => {
    await runWithCompany(await setup("in-9"), async () => {
      await recordInbound(ev({ text: "", at: min(0), media: { data: await png(), fileName: "screen.png", mime: "image/png" } }), "");
      const before = await prisma.waInbound.findFirstOrThrow();
      expect(before.mediaKey).not.toBeNull();
      expect((await runBotIntake(min(3))).tickets).toBe(1);
      const t = await prisma.ticket.findFirstOrThrow({ include: { attachments: true } });
      expect(t.attachments).toHaveLength(1);
      expect(t.attachments[0].messageId).not.toBeNull();
      // left for the attachments job so ocr doesn't hold up the minute loop
      expect(t.attachments[0].status).toBe("pending");
      expect((await prisma.waInbound.findFirstOrThrow()).mediaKey).toBeNull();
      expect(existsSync(path.join(dir, before.mediaKey!))).toBe(false);
      expect(await runPendingAttachments(new Date(Date.now() + 3 * 60_000))).toBe(1);
      expect((await prisma.attachment.findFirstOrThrow()).status).not.toBe("pending");
    });
  });

  it("a failed client step holds back the rest of that chat", async () => {
    await runWithCompany(await setup("in-10"), async () => {
      await recordInbound(ev({ text: "a", at: min(0) }), "");
      await runBotIntake(min(3));
      const aminah = await prisma.ticket.findFirstOrThrow();
      fail.senders.add("Siti");
      await recordInbound(ev({ ...siti, text: "b", at: min(10) }), "");
      await recordInbound(ev({ ...staff, text: "done", at: min(10.5) }), "");
      expect(await runBotIntake(min(11))).toMatchObject({ tickets: 0, answers: 0 });
      expect((await prisma.waInbound.findFirstOrThrow({ where: { text: "done" } })).state).toBe("pending");
      expect((await prisma.waInbound.findFirstOrThrow({ where: { text: "b" } })).attempts).toBe(1);
      expect(await prisma.message.count({ where: { conversationId: aminah.conversationId!, role: "agent" } })).toBe(0);
    });
  });

  it("gives up on rows after 5 failed tries and moves on", async () => {
    await runWithCompany(await setup("in-11"), async () => {
      const log = vi.spyOn(logger, "error");
      fail.senders.add("Siti");
      await recordInbound(ev({ ...siti, text: "b", at: min(0) }), "");
      for (let i = 0; i < 6; i++) await runBotIntake(min(3 + i));
      const row = await prisma.waInbound.findFirstOrThrow();
      expect(row).toMatchObject({ state: "failed", attempts: 5 });
      expect(row.doneAt).not.toBeNull();
      expect(log.mock.calls.filter(([m]) => m === "bot rows kept failing, giving up").length).toBe(1);
      log.mockRestore();
      fail.senders.clear();
      await recordInbound(ev({ ...siti, text: "lagi", at: min(20) }), "");
      expect((await runBotIntake(min(23))).tickets).toBe(1);
      expect((await prisma.ticket.findFirstOrThrow()).description).toBe("lagi");
      expect(await cleanBotInbound(new Date(min(23).getTime() + 8 * 86_400_000))).toBe(2);
    });
  });

  it("after giving up, a held staff reply waits for a person to place it", async () => {
    await runWithCompany(await setup("in-21"), async () => {
      await recordInbound(ev({ text: "a", at: min(0) }), "");
      await runBotIntake(min(3));
      const aminah = await prisma.ticket.findFirstOrThrow();
      fail.senders.add("Siti");
      await recordInbound(ev({ ...siti, text: "b", at: min(10) }), "");
      await recordInbound(ev({ ...staff, text: "done", at: min(10.5) }), "");
      for (let i = 0; i < 6; i++) await runBotIntake(min(11 + i));
      expect((await prisma.waInbound.findFirstOrThrow({ where: { text: "b" } })).state).toBe("failed");
      expect((await prisma.waInbound.findFirstOrThrow({ where: { text: "done" } })).state).toBe("pick");
      expect(await prisma.message.count({ where: { conversationId: aminah.conversationId!, role: "agent" } })).toBe(0);
    });
  });

  it("a given-up batch keeps the ticket its messages already reached", async () => {
    await runWithCompany(await setup("in-22"), async () => {
      // as if an earlier run saved the message and ticket, then kept failing
      await recordInbound(ev({ ...siti, waMessageId: "w22", text: "x", at: min(0) }), "");
      const conv = await prisma.conversation.create({ data: { channel: "whatsapp" } });
      await prisma.message.create({ data: { conversationId: conv.id, role: "customer", content: "x", importKey: "wam:w22" } });
      const t = await prisma.ticket.create({
        data: { number: 1, title: "x", description: "x", conversationId: conv.id, projectId: (await prisma.project.findFirstOrThrow()).id },
      });
      fail.senders.add("Siti");
      for (let i = 0; i < 5; i++) await runBotIntake(min(3 + i));
      expect(await prisma.waInbound.findFirstOrThrow()).toMatchObject({ state: "failed", ticketId: t.id });
    });
  });

  it("keeps the ticket when a stored image is missing", async () => {
    await runWithCompany(await setup("in-12"), async () => {
      await recordInbound(ev({ text: "", at: min(0), media: { data: await png(), fileName: "a.png", mime: "image/png" } }), "");
      const before = await prisma.waInbound.findFirstOrThrow();
      rmSync(path.join(dir, before.mediaKey!));
      expect((await runBotIntake(min(3))).tickets).toBe(1);
      expect(await prisma.waInbound.findFirstOrThrow()).toMatchObject({ state: "done", mediaKey: null });
      expect((await prisma.message.findFirstOrThrow()).content).toBe("[image]");
      expect(await prisma.attachment.count()).toBe(0);
    });
  });

  it("drops an image that isn't allowed", async () => {
    await runWithCompany(await setup("in-13"), async () => {
      const media = { data: Buffer.from("not an image"), fileName: "a.png", mime: "image/png" };
      await recordInbound(ev({ text: "tengok", at: min(0), media }), "");
      const before = await prisma.waInbound.findFirstOrThrow();
      expect((await runBotIntake(min(3))).tickets).toBe(1);
      expect(await prisma.attachment.count()).toBe(0);
      expect((await prisma.waInbound.findFirstOrThrow()).mediaKey).toBeNull();
      expect(existsSync(path.join(dir, before.mediaKey!))).toBe(false);
    });
  });

  it("a quoted client follow-up joins the old ticket even after 4 hours", async () => {
    await runWithCompany(await setup("in-14"), async () => {
      await recordInbound(ev({ waMessageId: "q14", text: "x", at: min(0) }), "");
      await runBotIntake(min(3));
      const later = new Date(T.getTime() + 5 * H);
      await recordInbound(ev({ text: "masih", at: later, quotedWaId: "q14" }), "");
      await runBotIntake(new Date(later.getTime() + 3 * 60_000));
      expect(await prisma.ticket.count()).toBe(1);
      expect(await prisma.message.count()).toBe(2);
    });
  });

  it("an unquoted client message after 4 hours opens a new ticket", async () => {
    await runWithCompany(await setup("in-15"), async () => {
      await recordInbound(ev({ text: "x", at: min(0) }), "");
      await runBotIntake(min(3));
      const later = new Date(T.getTime() + 5 * H);
      await recordInbound(ev({ text: "baru", at: later }), "");
      expect((await runBotIntake(new Date(later.getTime() + 3 * 60_000))).tickets).toBe(1);
      expect(await prisma.ticket.count()).toBe(2);
    });
  });

  it("a closed ticket isn't joined or placed on", async () => {
    await runWithCompany(await setup("in-16"), async () => {
      await recordInbound(ev({ text: "a", at: min(0) }), "");
      await recordInbound(ev({ ...siti, text: "b", at: min(0) }), "");
      await runBotIntake(min(3));
      await recordInbound(ev({ ...staff, text: "done", at: min(4) }), "");
      await runBotIntake(min(4));
      const pick = await prisma.waInbound.findFirstOrThrow({ where: { state: "pick" } });
      const closed = await prisma.ticket.findFirstOrThrow({ where: { description: "a" } });
      await prisma.ticket.update({ where: { id: closed.id }, data: { status: "closed", closedAt: new Date() } });
      expect(await placeReply(pick.id, closed.id)).toBe("gone");
      expect((await prisma.waInbound.findUniqueOrThrow({ where: { id: pick.id } })).state).toBe("pick");
      await recordInbound(ev({ text: "lagi", at: min(10) }), "");
      expect((await runBotIntake(min(13))).tickets).toBe(1);
    });
  });

  it("a run that died after the messages but before the ticket finishes the job", async () => {
    await runWithCompany(await setup("in-17"), async () => {
      fail.openTicket = 1;
      await recordInbound(ev({ text: "x", at: min(0) }), "");
      expect((await runBotIntake(min(3))).tickets).toBe(0);
      expect(await prisma.message.count()).toBe(1);
      expect((await runBotIntake(min(4))).tickets).toBe(1);
      expect(await prisma.message.count()).toBe(1);
      expect(await prisma.conversation.count()).toBe(1);
      const t = await prisma.ticket.findFirstOrThrow();
      expect((await prisma.waInbound.findFirstOrThrow()).ticketId).toBe(t.id);
    });
  });

  it("new tickets go to the default project when the chat's project is archived", async () => {
    await runWithCompany(await setup("in-18"), async () => {
      const p = await prisma.project.create({ data: { name: "Old client", archived: true } });
      await prisma.waChat.updateMany({ data: { projectId: p.id } });
      await recordInbound(ev({ text: "x", at: min(0) }), "");
      await runBotIntake(min(3));
      expect((await prisma.ticket.findFirstOrThrow()).projectId).toBe(await defaultProjectId());
    });
  });

  it("doesn't mark rows done that an unlink ignored meanwhile", async () => {
    await runWithCompany(await setup("in-20"), async () => {
      await recordInbound(ev({ text: "x", at: min(0) }), "");
      fail.onOpen = () => prisma.waInbound.updateMany({ data: { state: "ignored" } });
      await runBotIntake(min(3));
      expect((await prisma.waInbound.findFirstOrThrow()).state).toBe("ignored");
    });
  });

  it("puts a stuck placing row back to pick", async () => {
    await runWithCompany(await setup("in-19"), async () => {
      await recordInbound(ev({ text: "x", at: min(0) }), "");
      const row = await prisma.waInbound.findFirstOrThrow();
      await prisma.waInbound.update({ where: { id: row.id }, data: { state: "placing", doneAt: new Date(Date.now() - 6 * 60_000) } });
      await runBotIntake(new Date());
      expect(await prisma.waInbound.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ state: "pick", doneAt: null });
    });
  });
});
