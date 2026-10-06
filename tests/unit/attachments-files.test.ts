import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { prisma } from "@/lib/prisma";
import { fileStore } from "@/lib/storage";
import { imageForAi, removeAttachmentFiles } from "@/lib/attachments/files";

const attachment = (prisma as unknown as { attachment: Record<string, ReturnType<typeof vi.fn>> }).attachment;
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "helplus-files-"));
  process.env.HELPLUS_STORAGE_DIR = dir;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HELPLUS_STORAGE_DIR;
});

beforeEach(() => {
  for (const fn of Object.values(attachment)) fn.mockReset();
});

describe("imageForAi", () => {
  it("holds back pending and needs_check images", async () => {
    await fileStore().put("c/co/attachments/a1/masked.png", Buffer.from("masked"));
    for (const status of ["pending", "needs_check"]) {
      attachment.findUnique.mockResolvedValueOnce({ status, maskedKey: "c/co/attachments/a1/masked.png" });
      expect(await imageForAi("a1")).toBeNull();
    }
  });

  it("returns the masked bytes for clean and masked images", async () => {
    await fileStore().put("c/co/attachments/a2/masked.png", Buffer.from("masked"));
    for (const status of ["clean", "masked"]) {
      attachment.findUnique.mockResolvedValueOnce({ status, maskedKey: "c/co/attachments/a2/masked.png" });
      expect((await imageForAi("a2"))?.toString()).toBe("masked");
    }
  });

  it("returns null for a missing row or a row without a masked copy", async () => {
    attachment.findUnique.mockResolvedValueOnce(null);
    expect(await imageForAi("nope")).toBeNull();
    attachment.findUnique.mockResolvedValueOnce({ status: "clean", maskedKey: null });
    expect(await imageForAi("a3")).toBeNull();
  });
});

describe("removeAttachmentFiles", () => {
  it("removes both files and skips null keys", async () => {
    const store = fileStore();
    await store.put("c/co/attachments/b1/original.bin", Buffer.from("o"));
    await store.put("c/co/attachments/b1/masked.png", Buffer.from("m"));
    await store.put("c/co/attachments/b2/masked.png", Buffer.from("m"));
    attachment.findMany.mockResolvedValueOnce([
      { originalKey: "c/co/attachments/b1/original.bin", maskedKey: "c/co/attachments/b1/masked.png" },
      { originalKey: null, maskedKey: "c/co/attachments/b2/masked.png" },
    ]);

    expect(await removeAttachmentFiles({ ticketId: "t1" })).toBe(2);

    expect(attachment.findMany).toHaveBeenCalledWith({ where: { ticketId: "t1" }, select: { originalKey: true, maskedKey: true } });
    await expect(store.get("c/co/attachments/b1/original.bin")).rejects.toThrow();
    await expect(store.get("c/co/attachments/b1/masked.png")).rejects.toThrow();
    await expect(store.get("c/co/attachments/b2/masked.png")).rejects.toThrow();
  });
});
