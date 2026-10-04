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

describe("saveSettings key reset on provider change", () => {
  const echo = async ({ update }: { update: Record<string, unknown> }) => ({ ...fixtures.settings, ...update });

  beforeEach(() => {
    mockPrisma.settings.findUnique.mockResolvedValue({
      ...fixtures.settings,
      aiApiKey: encryptSecret("sk-old"),
      embedApiKey: encryptSecret("emb-old"),
    });
    mockPrisma.settings.upsert.mockImplementation(echo);
  });

  const written = () => mockPrisma.settings.upsert.mock.calls[0][0].update;

  it("clears the chat key when the provider changes without a new key", async () => {
    await saveSettings({ aiProvider: "deepseek", aiApiKey: "***" });
    expect(written().aiApiKey).toBe("");
  });

  it("clears the chat key when the provider changes and no key is sent", async () => {
    await saveSettings({ aiProvider: "deepseek" });
    expect(written().aiApiKey).toBe("");
  });

  it("keeps a new key sent with the provider change", async () => {
    const s = await saveSettings({ aiProvider: "deepseek", aiApiKey: "sk-deep" });
    expect(isEncrypted(written().aiApiKey)).toBe(true);
    expect(s.aiApiKey).toBe("sk-deep");
  });

  it("clears the chat key when the server URL changes", async () => {
    await saveSettings({ aiBaseUrl: "https://other.example.com/v1", aiApiKey: "***" });
    expect(written().aiApiKey).toBe("");
  });

  it("keeps the stored key when provider and URL stay the same", async () => {
    await saveSettings({ aiProvider: "openai", aiBaseUrl: "", aiApiKey: "***", businessName: "Y" });
    expect(written()).not.toHaveProperty("aiApiKey");
    expect(written()).not.toHaveProperty("embedApiKey");
  });

  it("clears the embed key when the embed provider changes", async () => {
    await saveSettings({ embedProvider: "ollama", embedApiKey: "***" });
    expect(written().embedApiKey).toBe("");
    expect(written()).not.toHaveProperty("aiApiKey");
  });

  it("clears the embed key when the embed URL changes", async () => {
    await saveSettings({ embedBaseUrl: "https://emb.example.com/v1" });
    expect(written().embedApiKey).toBe("");
  });

  it("keeps a new embed key sent with the change", async () => {
    const s = await saveSettings({ embedProvider: "custom", embedBaseUrl: "http://x/v1", embedApiKey: "emb-new" });
    expect(isEncrypted(written().embedApiKey)).toBe(true);
    expect(s.embedApiKey).toBe("emb-new");
  });
});
