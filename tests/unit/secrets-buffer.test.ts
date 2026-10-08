import { describe, it, expect } from "vitest";
import { encryptBuffer, decryptBuffer } from "@/lib/secrets";

describe("buffer encryption", () => {
  it("round trips and hides the bytes", () => {
    const data = Buffer.from("IC 900101-14-5678 in a screenshot");
    const enc = encryptBuffer(data);
    expect(enc.includes(Buffer.from("900101"))).toBe(false);
    expect(decryptBuffer(enc).equals(data)).toBe(true);
  });

  it("uses a fresh iv every time", () => {
    const data = Buffer.from("same");
    expect(encryptBuffer(data).equals(encryptBuffer(data))).toBe(false);
  });

  it("refuses tampered data", () => {
    const enc = encryptBuffer(Buffer.from("hello"));
    enc[enc.length - 1] ^= 1;
    expect(() => decryptBuffer(enc)).toThrow();
  });

  it("refuses data that isn't ours", () => {
    expect(() => decryptBuffer(Buffer.from("plain bytes"))).toThrow("not an encrypted file");
  });
});
