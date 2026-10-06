import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileStore, attachmentKey } from "@/lib/storage";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "helplus-store-"));
  process.env.HELPLUS_STORAGE_DIR = dir;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HELPLUS_STORAGE_DIR;
});

describe("local file store", () => {
  it("puts, gets and removes", async () => {
    const store = fileStore();
    const key = attachmentKey("co-1", "att-1", "masked");
    await store.put(key, Buffer.from("png bytes"));
    expect((await store.get(key)).toString()).toBe("png bytes");
    await store.remove(key);
    await expect(store.get(key)).rejects.toThrow();
  });

  it("removing a missing file is fine", async () => {
    await expect(fileStore().remove(attachmentKey("co-1", "nope", "original"))).resolves.toBeUndefined();
  });

  it("refuses keys that escape the folder", async () => {
    await expect(fileStore().put("../evil", Buffer.from("x"))).rejects.toThrow("bad storage key");
    await expect(fileStore().get("c/../../etc/passwd")).rejects.toThrow("bad storage key");
  });

  it("keys are per company", () => {
    expect(attachmentKey("co-1", "att-1", "original")).toBe("c/co-1/attachments/att-1/original.bin");
    expect(attachmentKey("co-1", "att-1", "masked")).toBe("c/co-1/attachments/att-1/masked.png");
  });
});
