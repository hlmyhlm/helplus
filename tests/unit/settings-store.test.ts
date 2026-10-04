import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { fixtures } from "../helpers/fixtures";
import { encryptSecret, isEncrypted } from "@/lib/secrets";
import { getSettings, saveSettings, prepareSettingsUpdate } from "@/lib/settings";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  mockPrisma.settings.findUnique.mockReset();
  mockPrisma.settings.create.mockReset();
  mockPrisma.settings.upsert.mockReset();
});

describe("getSettings", () => {
  it("decrypts secrets", async () => {
    mockPrisma.settings.findUnique.mockResolvedValue({
      ...fixtures.settings,
      aiApiKey: encryptSecret("sk-real"),
    });
    const s = await getSettings();
    expect(s.aiApiKey).toBe("sk-real");
    expect(s.businessName).toBe("Test Business");
  });

  it("creates the default row when missing", async () => {
    mockPrisma.settings.findUnique.mockResolvedValue(null);
    mockPrisma.settings.create.mockResolvedValue({ ...fixtures.settings });
    await getSettings();
    expect(mockPrisma.settings.create).toHaveBeenCalledWith({ data: { id: "default" } });
  });
});

describe("prepareSettingsUpdate", () => {
  it("drops masked secrets so the stored value survives", () => {
    const out = prepareSettingsUpdate({ aiApiKey: "***", businessName: "X" });
    expect(out).toEqual({ businessName: "X" });
  });

  it("encrypts new secrets and leaves other fields alone", () => {
    const out = prepareSettingsUpdate({ smtpPass: "hunter2", smtpHost: "mail.x" });
    expect(isEncrypted(out.smtpPass as string)).toBe(true);
    expect(out.smtpHost).toBe("mail.x");
  });

  it("keeps an empty secret empty so it can be cleared", () => {
    expect(prepareSettingsUpdate({ aiApiKey: "" })).toEqual({ aiApiKey: "" });
  });
});

describe("saveSettings", () => {
  it("writes encrypted values and returns decrypted ones", async () => {
    mockPrisma.settings.upsert.mockImplementation(async ({ update }) => ({
      ...fixtures.settings,
      ...update,
    }));
    const s = await saveSettings({ aiApiKey: "sk-new" });
    const written = mockPrisma.settings.upsert.mock.calls[0][0].update.aiApiKey;
    expect(isEncrypted(written)).toBe(true);
    expect(s.aiApiKey).toBe("sk-new");
  });
});
