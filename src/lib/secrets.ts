import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const PREFIX = "enc:v1:";

export class SecretKeyError extends Error {
  constructor() {
    super("HELPLUS_SECRET_KEY must be 64 hex characters (32 bytes)");
    this.name = "SecretKeyError";
  }
}

function key(): Buffer {
  const hex = process.env.HELPLUS_SECRET_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new SecretKeyError();
  return Buffer.from(hex, "hex");
}

export function assertSecretKey(): void {
  key();
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

// always encrypts, even text that looks encrypted, so pasted input can't skip it
export function encryptSecret(plain: string): string {
  if (!plain) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, body]).toString("base64");
}

// values saved before encryption existed come back unchanged
export function decryptSecret(value: string): string {
  if (!value || !isEncrypted(value)) return value;
  const raw = Buffer.from(value.slice(PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
