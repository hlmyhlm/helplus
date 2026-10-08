import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { createTicket } from "@/lib/tickets/service";
import { addAttachment } from "@/lib/attachments/service";
import { remask, confirmAttachment, processAttachment } from "@/lib/attachments/process";
import { imageForAi } from "@/lib/attachments/files";
import { runOriginalRetention } from "@/lib/jobs/attachments";
import { closeOcr, ocrImage } from "@/lib/ocr/tesseract";

// real ocr, but one test can make it fail
vi.mock("@/lib/ocr/tesseract", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ocr/tesseract")>();
  return { ...real, ocrImage: vi.fn(real.ocrImage) };
});

const A = "it-3a-ocr";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);
let dir: string;

const textImage = (text: string) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="160"><rect width="100%" height="100%" fill="white"/><text x="20" y="100" font-family="Arial" font-size="48" fill="black">${text}</text></svg>`
    )
  )
    .png()
    .toBuffer();

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "helplus-ocr-"));
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

describe("screenshot processing", { timeout: 120_000 }, () => {
  it("covers an IC and keeps the original encrypted", async () => {
    const t = await asA(() => createTicket({ text: "login issue" }));
    const a = await asA(async () => addAttachment({ ticketId: t.id, fileName: "s.png", data: await textImage("My IC 900101-14-5678 thanks") }));
    expect(["masked", "needs_check"]).toContain(a.status);
    if (a.status === "masked") {
      expect(a.icCount).toBe(1);
      expect(await asA(() => imageForAi(a.id))).toBeInstanceOf(Buffer);
    } else {
      expect(a.maskedKey).toBeNull();
    }
    const raw = await import("fs/promises").then((f) => f.readFile(path.join(dir, ...a.originalKey!.split("/"))));
    expect(raw.subarray(0, 4).toString()).toBe("HPE1");
  });

  it("an upload saved without checking stays pending until processAttachment runs", async () => {
    const t = await asA(() => createTicket({ text: "x" }));
    const a = await asA(async () =>
      addAttachment({ ticketId: t.id, fileName: "p.png", data: await textImage("Report page is empty") }, { process: false })
    );
    expect(a.status).toBe("pending");
    expect(a.maskedKey).toBeNull();
    const done = await asA(() => processAttachment(a.id));
    expect(done?.status).toBe("clean");
    expect(done?.maskedKey).not.toBeNull();
  });

  it("marks a clean image clean", async () => {
    const t = await asA(() => createTicket({ text: "x" }));
    const a = await asA(async () => addAttachment({ ticketId: t.id, fileName: "c.png", data: await textImage("Report page is empty") }));
    expect(a.status).toBe("clean");
    expect(a.icCount).toBe(0);
  });

  it("an ocr failure is held back with no masked copy until staff confirm", async () => {
    vi.mocked(ocrImage).mockRejectedValueOnce(new Error("ocr timed out"));
    const t = await asA(() => createTicket({ text: "x" }));
    const a = await asA(async () => addAttachment({ ticketId: t.id, fileName: "f.png", data: await textImage("Report page is empty") }));
    expect(a.status).toBe("needs_check");
    expect(a.maskedKey).toBeNull();
    expect(await asA(() => imageForAi(a.id))).toBeNull();
    const confirmed = await asA(() => confirmAttachment(a.id, { id: "api-key:x", name: "Tester" }));
    expect(confirmed.status).toBe("clean");
    expect(confirmed.maskedKey).not.toBeNull();
  });

  it("staff can cover more and confirm", async () => {
    const t = await asA(() => createTicket({ text: "x" }));
    const a = await asA(async () => addAttachment({ ticketId: t.id, fileName: "m.png", data: await textImage("Name Ali") }));
    const masked = await asA(() => remask(a.id, [{ x: 10, y: 10, w: 100, h: 40 }], { id: "api-key:x", name: "Tester" }));
    expect(masked.status).toBe("masked");
    expect(masked.icCount).toBe(1);
    const confirmed = await asA(() => confirmAttachment(a.id, { id: "api-key:x", name: "Tester" }));
    expect(confirmed.status).toBe("masked");
  });

  it("deletes originals after the retention days", async () => {
    const t = await asA(() => createTicket({ text: "x" }));
    const a = await asA(async () => addAttachment({ ticketId: t.id, fileName: "r.png", data: await textImage("old") }));
    await asA(() => prisma.ticket.update({ where: { id: t.id }, data: { status: "closed", closedAt: new Date(Date.now() - 100 * 86_400_000) } }));
    await asA(() => runOriginalRetention(new Date()));
    const after = await asA(() => prisma.attachment.findUniqueOrThrow({ where: { id: a.id } }));
    expect(after.originalKey).toBeNull();
    expect(after.originalDeletedAt).not.toBeNull();
    expect(after.maskedKey).not.toBeNull();
  });
});
