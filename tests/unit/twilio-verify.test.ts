import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/secrets";
import { fixtures } from "../helpers/fixtures";
import { validateTwilioSignature, getTwilioAuthToken, UndecryptableSecretError } from "@/lib/twilio-verify";
import { runWithCompany } from "@/lib/tenant/context";

// callers always run inside a company, so the tests do too
const inCompany = (fn: () => Promise<void>) => () => runWithCompany("test-company", fn);

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

describe("Twilio Signature Validation", () => {
  const authToken = "test-auth-token-12345";
  const url = "https://example.com/api/channels/phone/incoming";
  const params = { CallSid: "CA123", From: "+1555000111", To: "+1555000222" };

  function generateValidSignature(token: string, reqUrl: string, reqParams: Record<string, string>): string {
    const data = reqUrl + Object.keys(reqParams).sort().reduce((acc, key) => acc + key + reqParams[key], "");
    return crypto.createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
  }

  it("should validate correct signature", () => {
    const signature = generateValidSignature(authToken, url, params);
    expect(validateTwilioSignature(authToken, signature, url, params)).toBe(true);
  });

  it("should reject incorrect signature", () => {
    expect(validateTwilioSignature(authToken, "invalid-signature", url, params)).toBe(false);
  });

  it("should reject empty auth token", () => {
    const signature = generateValidSignature(authToken, url, params);
    expect(validateTwilioSignature("", signature, url, params)).toBe(false);
  });

  it("should reject empty signature", () => {
    expect(validateTwilioSignature(authToken, "", url, params)).toBe(false);
  });

  it("should reject tampered params", () => {
    const signature = generateValidSignature(authToken, url, params);
    const tampered = { ...params, From: "+1999999999" };
    expect(validateTwilioSignature(authToken, signature, url, tampered)).toBe(false);
  });
});

describe("getTwilioAuthToken", () => {
  it("returns the token", inCompany(async () => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings, twilioToken: encryptSecret("tw") });
    expect(await getTwilioAuthToken()).toBe("tw");
  }));

  it("returns empty when no token is set", inCompany(async () => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings, twilioToken: "" });
    expect(await getTwilioAuthToken()).toBe("");
  }));

  it("throws when a token is stored but can't be decrypted", inCompany(async () => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings, twilioToken: encryptSecret("tw") });
    process.env.HELPLUS_SECRET_KEY = "b2".repeat(32);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(getTwilioAuthToken()).rejects.toThrow(UndecryptableSecretError);
    } finally {
      process.env.HELPLUS_SECRET_KEY = "a1".repeat(32);
      warn.mockRestore();
    }
  }));
});
