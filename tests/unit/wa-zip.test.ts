import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readExport } from "@/lib/imports/whatsapp/zip";

const CHAT = "12/10/2026, 9:06 am - Aminah: Salam\n";

function zip(files: Record<string, Uint8Array>): Buffer {
  return Buffer.from(zipSync(files, { level: 0 }));
}

// rewrite the declared uncompressed size of every entry, the data itself stays tiny
function fakeSizes(data: Buffer, size: number): Buffer {
  const out = Buffer.from(data);
  for (let i = 0; i < out.length - 4; i++) {
    const sig = out.readUInt32LE(i);
    if (sig === 0x04034b50) out.writeUInt32LE(size, i + 22);
    if (sig === 0x02014b50) out.writeUInt32LE(size, i + 24);
  }
  return out;
}

describe("readExport", () => {
  it("reads a plain .txt upload", () => {
    const res = readExport(Buffer.from(CHAT), "WhatsApp Chat with Aminah.txt");
    expect(res.chat).toBe(CHAT);
    expect(res.files.size).toBe(0);
    expect(res.skippedFiles).toBe(0);
  });

  it("keeps the chat and images, skips the rest", () => {
    const data = zip({
      "WhatsApp Chat with Aminah.txt": strToU8(CHAT),
      "IMG-1.jpg": new Uint8Array([1, 2, 3]),
      "IMG-2.png": new Uint8Array([4, 5]),
      "PTT-1.opus": new Uint8Array([6]),
    });
    const res = readExport(data, "export.zip");
    expect(res.chat).toBe(CHAT);
    expect([...res.files.keys()].sort()).toEqual(["IMG-1.jpg", "IMG-2.png"]);
    expect(res.files.get("IMG-1.jpg")).toEqual(Buffer.from([1, 2, 3]));
    expect(res.skippedFiles).toBe(1);
  });

  it("throws when the zip has no chat text", () => {
    const data = zip({ "IMG-1.jpg": new Uint8Array([1]) });
    expect(() => readExport(data, "export.zip")).toThrow("This isn't a WhatsApp export");
  });

  it("throws on a corrupt zip", () => {
    expect(() => readExport(Buffer.from("not a zip at all"), "export.zip")).toThrow("This isn't a WhatsApp export");
  });

  it("refuses a zip whose declared size is too big", () => {
    const data = fakeSizes(
      zip({ "WhatsApp Chat.txt": strToU8(CHAT), "a.bin": new Uint8Array([1]), "b.bin": new Uint8Array([1]) }),
      300 * 1024 * 1024
    );
    expect(() => readExport(data, "export.zip")).toThrow(/too large/);
  });

  it("keys nested files by base name", () => {
    const data = zip({ "WhatsApp Chat.txt": strToU8(CHAT), "media/IMG-1.jpg": new Uint8Array([9]) });
    const res = readExport(data, "export.zip");
    expect(res.files.has("IMG-1.jpg")).toBe(true);
    expect(res.files.has("media/IMG-1.jpg")).toBe(false);
  });

  it("skips an image over 10 MB", () => {
    // only the image entry gets a fake 11 MB size
    const out = zip({ "WhatsApp Chat.txt": strToU8(CHAT), "IMG-big.jpg": new Uint8Array([1]) });
    for (let i = 0; i < out.length - 4; i++) {
      const sig = out.readUInt32LE(i);
      const nameAt = sig === 0x04034b50 ? i + 30 : sig === 0x02014b50 ? i + 46 : -1;
      if (nameAt < 0) continue;
      const nameLen = out.readUInt16LE(sig === 0x04034b50 ? i + 26 : i + 28);
      if (!out.subarray(nameAt, nameAt + nameLen).toString().endsWith(".jpg")) continue;
      out.writeUInt32LE(11 * 1024 * 1024, sig === 0x04034b50 ? i + 22 : i + 24);
    }
    const res = readExport(out, "export.zip");
    expect(res.files.size).toBe(0);
    expect(res.skippedFiles).toBe(1);
  });
});
