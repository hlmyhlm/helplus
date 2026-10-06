import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { encryptBuffer } from "@/lib/secrets";
import { fileStore } from "@/lib/storage";
import { ocrImage } from "@/lib/ocr/tesseract";
import { findIcBoxes, needsCheck } from "@/lib/privacy/ic-image";
import { processAttachment, confirmAttachment } from "@/lib/attachments/process";

vi.mock("@/lib/storage", () => ({ fileStore: vi.fn(), attachmentKey: vi.fn(() => "c/co/attachments/a1/masked.png") }));
vi.mock("@/lib/ocr/tesseract", () => ({ ocrImage: vi.fn() }));
vi.mock("@/lib/tenant/context", () => ({ currentCompanyId: () => "co" }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/privacy/ic-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/privacy/ic-image")>()),
  findIcBoxes: vi.fn(),
  needsCheck: vi.fn(),
}));

const attachment = (prisma as unknown as { attachment: Record<string, ReturnType<typeof vi.fn>> }).attachment;
const files = new Map<string, Buffer>();
const store = {
  get: vi.fn(async (k: string) => {
    if (!files.has(k)) throw new Error("ENOENT");
    return files.get(k)!;
  }),
  put: vi.fn(async (k: string, d: Buffer) => void files.set(k, d)),
  remove: vi.fn(async (k: string) => void files.delete(k)),
};
const ORIGINAL = "c/co/attachments/a1/original.bin";
const MASKED = "c/co/attachments/a1/masked.png";
let row: Record<string, unknown>;

const png = () => sharp({ create: { width: 40, height: 20, channels: 3, background: "#ffffff" } }).png().toBuffer();
const ocr = { confidence: 50, lines: [{ words: [{ text: "900101-14-5678", confidence: 60, bbox: { x0: 1, y0: 1, x1: 30, y1: 10 } }] }] };

beforeEach(async () => {
  for (const fn of Object.values(attachment)) fn.mockReset();
  for (const fn of Object.values(store)) fn.mockClear();
  files.clear();
  files.set(ORIGINAL, encryptBuffer(await png()));
  vi.mocked(fileStore).mockReturnValue(store);
  vi.mocked(ocrImage).mockReset().mockResolvedValue(ocr);
  vi.mocked(findIcBoxes).mockReset().mockReturnValue([]);
  vi.mocked(needsCheck).mockReset().mockReturnValue(false);
  row = { id: "a1", status: "pending", originalKey: ORIGINAL, maskedKey: null, icCount: 0, autoBoxes: [], manualBoxes: [] };
  attachment.findUnique.mockImplementation(async () => ({ ...row }));
  attachment.updateMany.mockImplementation(async ({ where, data }) => {
    if (row.status !== where.status) return { count: 0 };
    row = { ...row, ...data };
    return { count: 1 };
  });
  attachment.update.mockImplementation(async ({ data }) => (row = { ...row, ...data }));
});

describe("processAttachment", () => {
  it("writes a masked copy for a confident result", async () => {
    vi.mocked(findIcBoxes).mockReturnValue([{ x: 0, y: 0, w: 10, h: 10 }]);
    const a = await processAttachment("a1");
    expect(a).toMatchObject({ status: "masked", icCount: 1, maskedKey: MASKED });
    expect(files.has(MASKED)).toBe(true);
  });

  it("low confidence keeps the boxes but writes no masked copy", async () => {
    vi.mocked(needsCheck).mockReturnValue(true);
    vi.mocked(findIcBoxes).mockReturnValue([{ x: 0, y: 0, w: 10, h: 10 }]);
    const a = await processAttachment("a1");
    expect(a).toMatchObject({ status: "needs_check", maskedKey: null, icCount: 1, autoBoxes: [{ x: 0, y: 0, w: 10, h: 10 }] });
    expect(store.put).not.toHaveBeenCalled();
  });

  it("an ocr error writes no masked copy", async () => {
    vi.mocked(ocrImage).mockRejectedValue(new Error("ocr timed out"));
    const a = await processAttachment("a1");
    expect(a).toMatchObject({ status: "needs_check", maskedKey: null, autoBoxes: [], checkNote: "OCR couldn't read this image." });
    expect(store.put).not.toHaveBeenCalled();
  });

  it("marks it needs_check when storage can't read the file", async () => {
    files.delete(ORIGINAL);
    const a = await processAttachment("a1");
    expect(a).toMatchObject({ status: "needs_check", maskedKey: null, checkNote: "Couldn't read the original file." });
    expect(ocrImage).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it("marks it needs_check when the original won't decrypt", async () => {
    files.set(ORIGINAL, Buffer.from("not encrypted"));
    const a = await processAttachment("a1");
    expect(a).toMatchObject({ status: "needs_check", maskedKey: null, checkNote: "Couldn't read the original file." });
    expect(ocrImage).not.toHaveBeenCalled();
  });

  it("doesn't overwrite a row that was handled meanwhile", async () => {
    vi.mocked(ocrImage).mockImplementation(async () => {
      row = { ...row, status: "clean", maskedKey: null };
      return ocr;
    });
    const a = await processAttachment("a1");
    expect(a?.status).toBe("clean");
    expect(attachment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a1", status: "pending" } }));
    expect(files.has(MASKED)).toBe(false);
  });
});

describe("confirmAttachment", () => {
  it("renders the masked copy from the original and sets the status", async () => {
    row = { ...row, status: "needs_check", icCount: 1, autoBoxes: [{ x: 0, y: 0, w: 10, h: 10 }] };
    const a = await confirmAttachment("a1", { id: "admin-1", name: "Siti" });
    expect(a).toMatchObject({ status: "masked", maskedKey: MASKED, checkedById: "admin-1" });
    expect(files.has(MASKED)).toBe(true);
  });

  it("marks an image with nothing found clean", async () => {
    row = { ...row, status: "needs_check" };
    const a = await confirmAttachment("a1", { id: "api-key:k", name: "Bot" });
    expect(a).toMatchObject({ status: "clean", maskedKey: MASKED, checkedById: null });
  });

  it("throws when the original was deleted", async () => {
    row = { ...row, status: "needs_check", originalKey: null };
    await expect(confirmAttachment("a1", { id: "admin-1", name: "Siti" })).rejects.toThrow("the original was deleted");
    expect(attachment.update).not.toHaveBeenCalled();
  });
});
