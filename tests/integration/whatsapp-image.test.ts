import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { createTicket } from "@/lib/tickets/service";
import { attachIncomingImage } from "@/lib/attachments/service";
import { closeOcr } from "@/lib/ocr/tesseract";

const A = "it-3a-wa";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);
let dir: string;
const png = () => sharp({ create: { width: 200, height: 80, channels: 3, background: "#ffffff" } }).png().toBuffer();

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "helplus-wa-"));
  process.env.HELPLUS_STORAGE_DIR = dir;
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "A", slug: A } });
});

afterAll(async () => {
  await closeOcr();
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("incoming whatsapp images", { timeout: 120_000 }, () => {
  it("land on the open ticket next to the last client message", async () => {
    const t = await asA(() => createTicket({ text: "screen attached" }));
    const a = await asA(async () => attachIncomingImage(t.conversationId!, await png(), "wa.jpg"));
    expect(a?.ticketId).toBe(t.id);
    const msg = await asA(() => prisma.message.findFirst({ where: { conversationId: t.conversationId!, role: "customer" } }));
    expect(a?.messageId).toBe(msg?.id);
  });

  it("are dropped when the conversation has no open ticket", async () => {
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "whatsapp" } }));
    expect(await asA(async () => attachIncomingImage(conv.id, await png(), "wa.jpg"))).toBeNull();
    expect(await asA(() => prisma.attachment.count({ where: { ticket: { conversationId: conv.id } } }))).toBe(0);
  });

  it("ignore files that aren't images", async () => {
    const t = await asA(() => createTicket({ text: "pdf" }));
    expect(await asA(() => attachIncomingImage(t.conversationId!, Buffer.from("%PDF-1.4"), "a.pdf"))).toBeNull();
  });
});
