import { describe, it, expect, afterEach } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted, assertSecretKey, SecretKeyError } from "@/lib/secrets";

const KEY = "a1".repeat(32);

afterEach(() => {
  process.env.HELPLUS_SECRET_KEY = KEY;
});

describe("secrets", () => {
  it("round-trips a value", () => {
    const enc = encryptSecret("sk-live-abc123");
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain("sk-live-abc123");
    expect(decryptSecret(enc)).toBe("sk-live-abc123");
  });

  it("uses a fresh iv every time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("leaves empty strings alone", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  it("encrypts input that only looks encrypted", () => {
    const pasted = "enc:v1:not-really";
    const enc = encryptSecret(pasted);
    expect(enc).not.toBe(pasted);
    expect(decryptSecret(enc)).toBe(pasted);
  });

  it("returns old plain-text values as they are", () => {
    expect(decryptSecret("sk-old-plain")).toBe("sk-old-plain");
  });

  it("throws when the value was tampered with", () => {
    const enc = encryptSecret("secret");
    const raw = Buffer.from(enc.slice("enc:v1:".length), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret("enc:v1:" + raw.toString("base64"))).toThrow();
  });

  it("throws without a valid key", () => {
    process.env.HELPLUS_SECRET_KEY = "short";
    expect(() => encryptSecret("x")).toThrow(/HELPLUS_SECRET_KEY/);
    expect(() => encryptSecret("x")).toThrow(SecretKeyError);
  });

  it("assertSecretKey passes with a valid key and throws without one", () => {
    expect(() => assertSecretKey()).not.toThrow();
    delete process.env.HELPLUS_SECRET_KEY;
    expect(() => assertSecretKey()).toThrow(SecretKeyError);
  });
});
