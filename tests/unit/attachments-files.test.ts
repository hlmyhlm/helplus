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
  it("removes every file in each attachment's folder, spare renders too", async () => {
    const store = fileStore();
    await store.put("c/co/attachments/b1/original.bin", Buffer.from("o"));
    await store.put("c/co/attachments/b1/masked-r1.png", Buffer.from("m"));
    await store.put("c/co/attachments/b1/masked-spare.png", Buffer.from("m"));
    await store.put("c/co/attachments/b2/masked-r2.png", Buffer.from("m"));
    await store.put("c/co/attachments/keep/masked-r3.png", Buffer.from("m"));
    attachment.findMany.mockResolvedValueOnce([
      { id: "b1", companyId: "co" },
      { id: "b2", companyId: "co" },
    ]);

    expect(await removeAttachmentFiles({ ticketId: "t1" })).toBe(2);

    expect(attachment.findMany).toHaveBeenCalledWith({ where: { ticketId: "t1" }, select: { id: true, companyId: true } });
    for (const key of ["b1/original.bin", "b1/masked-r1.png", "b1/masked-spare.png", "b2/masked-r2.png"]) {
      await expect(store.get(`c/co/attachments/${key}`)).rejects.toThrow();
    }
    expect((await store.get("c/co/attachments/keep/masked-r3.png")).toString()).toBe("m");
  });

  it("keeps going when one folder can't be removed", async () => {
    await fileStore().put("c/co/attachments/b4/original.bin", Buffer.from("o"));
    attachment.findMany.mockResolvedValueOnce([
      { id: "../b3", companyId: "co" },
      { id: "b4", companyId: "co" },
    ]);
    expect(await removeAttachmentFiles({ ticketId: "t2" })).toBe(2);
    await expect(fileStore().get("c/co/attachments/b4/original.bin")).rejects.toThrow();
  });
});
