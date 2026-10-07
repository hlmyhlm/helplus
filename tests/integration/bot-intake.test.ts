import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

const ids = ["in-1", "in-2", "in-3", "in-4", "in-5", "in-6", "in-7", "in-8", "in-9"].map((s) => `it-3c-${s}`);
let dir: string;

const T = new Date("2026-10-11T02:00:00Z");
const min = (n: number) => new Date(T.getTime() + n * 60_000);
let n = 0;
const ev = (over: Partial<IncomingEvent>): IncomingEvent => ({
  waMessageId: `m${++n}`, chatWaId: "120@g.us", chatName: "Kedai", isGroup: true,
  senderId: "60199999999@c.us", senderName: "Aminah", text: "hello", at: T, quotedWaId: null, media: null, ...over,
});
const staff = { senderId: "60188888888@c.us", senderName: "Support Ali" };

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
      await recordInbound(ev({ senderId: "60177777777@c.us", senderName: "Siti", text: "b", at: min(0) }), "");
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
      await recordInbound(ev({ senderId: "60177777777@c.us", senderName: "Siti", text: "b", at: min(0) }), "");
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
      const png = await sharp({ create: { width: 200, height: 80, channels: 3, background: "#ffffff" } }).png().toBuffer();
      await recordInbound(ev({ text: "", at: min(0), media: { data: png, fileName: "screen.png", mime: "image/png" } }), "");
      const before = await prisma.waInbound.findFirstOrThrow();
      expect(before.mediaKey).not.toBeNull();
      expect((await runBotIntake(min(3))).tickets).toBe(1);
      const t = await prisma.ticket.findFirstOrThrow({ include: { attachments: true } });
      expect(t.attachments).toHaveLength(1);
      expect(t.attachments[0].messageId).not.toBeNull();
      const row = await prisma.waInbound.findFirstOrThrow();
      expect(row.mediaKey).toBeNull();
      expect(existsSync(path.join(dir, before.mediaKey!))).toBe(false);
    });
  });
});
