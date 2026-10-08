import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { encryptBuffer } from "@/lib/secrets";
import { fileStore } from "@/lib/storage";
import { ocrImage } from "@/lib/ocr/tesseract";
import { findIcBoxes, needsCheck } from "@/lib/privacy/ic-image";
import { processAttachment, confirmAttachment, remask } from "@/lib/attachments/process";

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  fileStore: vi.fn(),
}));
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
  removeFolder: vi.fn(),
};
const ORIGINAL = "c/co/attachments/a1/original.bin";
const RENDER = /^c\/co\/attachments\/a1\/masked-[0-9a-f-]{36}\.png$/;
const renders = () => [...files.keys()].filter((k) => k.includes("/masked"));
let row: Record<string, unknown>;

const png = () => sharp({ create: { width: 40, height: 20, channels: 3, background: "#ffffff" } }).png().toBuffer();
const ocr = { confidence: 50, lines: [{ words: [{ text: "900101-14-5678", confidence: 60, bbox: { x0: 1, y0: 1, x1: 30, y1: 10 } }] }] };
const staff = { id: "admin-1", name: "Siti" };

beforeEach(async () => {
  for (const fn of Object.values(attachment)) fn.mockReset();
  for (const fn of Object.values(store)) fn.mockClear();
  files.clear();
  files.set(ORIGINAL, encryptBuffer(await png()));
  vi.mocked(fileStore).mockReturnValue(store);
  vi.mocked(ocrImage).mockReset().mockResolvedValue(ocr);
  vi.mocked(findIcBoxes).mockReset().mockReturnValue([]);
  vi.mocked(needsCheck).mockReset().mockReturnValue(false);
  row = { id: "a1", status: "pending", originalKey: ORIGINAL, maskedKey: null, icCount: 0, autoBoxes: [], manualBoxes: [], updatedAt: new Date(1000) };
  attachment.findUnique.mockImplementation(async () => ({ ...row }));
  attachment.updateMany.mockImplementation(async ({ where, data }) => {
    const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
    if (!Object.entries(where as Record<string, unknown>).every(([k, v]) => same(row[k], v))) return { count: 0 };
    row = { ...row, ...data, updatedAt: new Date((row.updatedAt as Date).getTime() + 1) };
    return { count: 1 };
  });
  attachment.update.mockImplementation(async ({ data }) => (row = { ...row, ...data }));
});

describe("processAttachment", () => {
  it("writes a masked copy for a confident result", async () => {
    vi.mocked(findIcBoxes).mockReturnValue([{ x: 0, y: 0, w: 10, h: 10 }]);
    const a = await processAttachment("a1");
    expect(a).toMatchObject({ status: "masked", icCount: 1, maskedKey: expect.stringMatching(RENDER) });
    expect(renders()).toEqual([a?.maskedKey]);
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

  it("a losing run leaves the winner's file and row alone", async () => {
    // the fixed key every render used to share
    const winner = "c/co/attachments/a1/masked.png";
    vi.mocked(findIcBoxes).mockReturnValue([]);
    vi.mocked(ocrImage).mockImplementation(async () => {
      // staff checked it while this run was still reading
      files.set(winner, Buffer.from("checked render"));
      row = { ...row, status: "masked", maskedKey: winner };
      return ocr;
    });
    const a = await processAttachment("a1");
    expect(a).toMatchObject({ status: "masked", maskedKey: winner });
    expect(attachment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a1", status: "pending" } }));
    expect(files.get(winner)?.toString()).toBe("checked render");
    expect(renders()).toEqual([winner]);
  });

  it("still returns the row if cleaning up a losing render fails", async () => {
    vi.mocked(ocrImage).mockImplementation(async () => {
      row = { ...row, status: "clean" };
      return ocr;
    });
    store.remove.mockRejectedValueOnce(new Error("disk"));
    expect((await processAttachment("a1"))?.status).toBe("clean");
  });
});

describe("confirmAttachment", () => {
  it("renders the masked copy from the original and sets the status", async () => {
    row = { ...row, status: "needs_check", icCount: 1, autoBoxes: [{ x: 0, y: 0, w: 10, h: 10 }] };
    const a = await confirmAttachment("a1", staff);
    expect(a).toMatchObject({ status: "masked", maskedKey: expect.stringMatching(RENDER), checkedById: "admin-1" });
    expect(renders()).toEqual([a.maskedKey]);
  });

  it("marks an image with nothing found clean", async () => {
    row = { ...row, status: "needs_check" };
    const a = await confirmAttachment("a1", { id: "api-key:k", name: "Bot" });
    expect(a).toMatchObject({ status: "clean", maskedKey: expect.stringMatching(RENDER), checkedById: null });
  });

  it("refuses when someone changed the row while it rendered", async () => {
    const theirs = "c/co/attachments/a1/masked-theirs.png";
    row = { ...row, status: "needs_check", icCount: 1, autoBoxes: [{ x: 0, y: 0, w: 10, h: 10 }] };
    store.get.mockImplementationOnce(async (k: string) => {
      files.set(theirs, Buffer.from("their render"));
      row = { ...row, status: "masked", maskedKey: theirs, updatedAt: new Date(5000) };
      return files.get(k)!;
    });
    await expect(confirmAttachment("a1", staff)).rejects.toThrow("changed by someone else");
    expect(row).toMatchObject({ status: "masked", maskedKey: theirs });
    expect(files.get(theirs)?.toString()).toBe("their render");
    expect(renders()).toEqual([theirs]);
  });

  it("throws when the original was deleted", async () => {
    row = { ...row, status: "needs_check", originalKey: null };
    await expect(confirmAttachment("a1", staff)).rejects.toThrow("the original was deleted");
    expect(attachment.update).not.toHaveBeenCalled();
    expect(attachment.updateMany).not.toHaveBeenCalled();
  });
});

describe("remask", () => {
  it("removes the old render", async () => {
    const old = "c/co/attachments/a1/masked-old.png";
    files.set(old, Buffer.from("old"));
    row = { ...row, status: "masked", maskedKey: old };
    const a = await remask("a1", [{ x: 1, y: 1, w: 5, h: 5 }], staff);
    expect(a.maskedKey).toMatch(RENDER);
    expect(a.maskedKey).not.toBe(old);
    expect(renders()).toEqual([a.maskedKey]);
  });

  it("refuses when someone changed the row while it rendered", async () => {
    const theirs = "c/co/attachments/a1/masked-theirs.png";
    files.set(theirs, Buffer.from("their render"));
    row = { ...row, status: "masked", maskedKey: theirs };
    store.get.mockImplementationOnce(async (k: string) => {
      row = { ...row, manualBoxes: [{ x: 2, y: 2, w: 3, h: 3 }], updatedAt: new Date(5000) };
      return files.get(k)!;
    });
    await expect(remask("a1", [{ x: 1, y: 1, w: 5, h: 5 }], staff)).rejects.toThrow("changed by someone else");
    expect(row).toMatchObject({ maskedKey: theirs, manualBoxes: [{ x: 2, y: 2, w: 3, h: 3 }] });
    expect(files.get(theirs)?.toString()).toBe("their render");
    expect(renders()).toEqual([theirs]);
  });

  it("confirm then remask keeps the row and the file in step", async () => {
    row = { ...row, status: "needs_check" };
    const confirmed = await confirmAttachment("a1", staff);
    const masked = await remask("a1", [{ x: 1, y: 1, w: 5, h: 5 }], staff);
    expect(masked.maskedKey).not.toBe(confirmed.maskedKey);
    expect(row.maskedKey).toBe(masked.maskedKey);
    expect(renders()).toEqual([masked.maskedKey]);
  });
});
