import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileStore, attachmentKey, attachmentFolder } from "@/lib/storage";

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

  it("removes a whole folder and refuses unsafe ones", async () => {
    const store = fileStore();
    await store.put("c/co-1/attachments/att-2/original.bin", Buffer.from("o"));
    await store.put("c/co-1/attachments/att-2/masked-r1.png", Buffer.from("m"));
    await store.put("c/co-1/attachments/att-3/masked-r1.png", Buffer.from("m"));
    await store.removeFolder(attachmentFolder("co-1", "att-2"));
    await expect(store.get("c/co-1/attachments/att-2/original.bin")).rejects.toThrow();
    await expect(store.get("c/co-1/attachments/att-2/masked-r1.png")).rejects.toThrow();
    expect((await store.get("c/co-1/attachments/att-3/masked-r1.png")).toString()).toBe("m");
    await expect(store.removeFolder("c/co-1/attachments/missing")).resolves.toBeUndefined();
    await expect(store.removeFolder("../x")).rejects.toThrow("bad storage key");
    await expect(store.removeFolder("")).rejects.toThrow("bad storage key");
  });

  it("an attachment folder holds its files", () => {
    expect(attachmentFolder("co-1", "att-1")).toBe("c/co-1/attachments/att-1");
    expect(attachmentKey("co-1", "att-1", "masked", "r1").startsWith(attachmentFolder("co-1", "att-1") + "/")).toBe(true);
  });

  it("keys are per company", () => {
    expect(attachmentKey("co-1", "att-1", "original")).toBe("c/co-1/attachments/att-1/original.bin");
    expect(attachmentKey("co-1", "att-1", "masked")).toBe("c/co-1/attachments/att-1/masked.png");
  });

  it("each masked render gets its own key", () => {
    expect(attachmentKey("co-1", "att-1", "masked", "r1")).toBe("c/co-1/attachments/att-1/masked-r1.png");
    expect(attachmentKey("co-1", "att-1", "original", "r1")).toBe("c/co-1/attachments/att-1/original.bin");
  });
});
