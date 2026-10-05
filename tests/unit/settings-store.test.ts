import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { fixtures } from "../helpers/fixtures";
import { encryptSecret, isEncrypted } from "@/lib/secrets";
import { getSettings, getSettingsWithStatus, saveSettings, prepareSettingsUpdate, reencryptSecrets } from "@/lib/settings";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  mockPrisma.settings.findUnique.mockReset();
  mockPrisma.settings.create.mockReset();
  mockPrisma.settings.upsert.mockReset();
});

describe("getSettings", () => {
  it("decrypts secrets", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({
      ...fixtures.settings,
      aiApiKey: encryptSecret("sk-real"),
    });
    const s = await getSettings();
    expect(s.aiApiKey).toBe("sk-real");
    expect(s.businessName).toBe("Test Business");
  });

  it("creates the default row in one upsert", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings });
    await getSettings();
    expect(mockPrisma.settings.upsert).toHaveBeenCalledWith({
      where: { id: "default" },
      update: {},
      create: { id: "default" },
    });
    expect(mockPrisma.settings.create).not.toHaveBeenCalled();
  });

  it("blanks a secret it can't decrypt and names only the field", async () => {
    const enc = encryptSecret("sk-real");
    const raw = Buffer.from(enc.slice("enc:v1:".length), "base64");
    raw[raw.length - 1] ^= 1;
    mockPrisma.settings.upsert.mockResolvedValue({
      ...fixtures.settings,
      aiApiKey: "enc:v1:" + raw.toString("base64"),
      smtpPass: encryptSecret("hunter2"),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await getSettings();
    expect(s.aiApiKey).toBe("");
    expect(s.smtpPass).toBe("hunter2");
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("aiApiKey");
    expect(logged).not.toContain("enc:v1:");
    warn.mockRestore();
  });

  it("blanks secrets when the key is missing", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings, aiApiKey: encryptSecret("sk-real") });
    const saved = process.env.HELPLUS_SECRET_KEY;
    delete process.env.HELPLUS_SECRET_KEY;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const s = await getSettings();
      expect(s.aiApiKey).toBe("");
      expect(s.businessName).toBe("Test Business");
    } finally {
      process.env.HELPLUS_SECRET_KEY = saved;
      warn.mockRestore();
    }
  });
});

describe("prepareSettingsUpdate", () => {
  it("drops masked secrets so the stored value survives", () => {
    const out = prepareSettingsUpdate({ aiApiKey: "***", businessName: "X" });
    expect(out).toEqual({ businessName: "X" });
  });

  it("encrypts a pasted value that looks encrypted", () => {
    const out = prepareSettingsUpdate({ aiApiKey: "enc:v1:abc" });
    expect(out.aiApiKey).not.toBe("enc:v1:abc");
    expect(isEncrypted(out.aiApiKey as string)).toBe(true);
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

describe("getSettingsWithStatus", () => {
  it("lists secrets that are stored but can't be decrypted", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({
      ...fixtures.settings,
      twilioToken: encryptSecret("tw"),
      smtpPass: "",
      aiApiKey: "sk-plain",
    });
    process.env.HELPLUS_SECRET_KEY = "b2".repeat(32);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { settings, undecryptable } = await getSettingsWithStatus();
      expect(undecryptable).toEqual(["twilioToken"]);
      expect(settings.twilioToken).toBe("");
      expect(settings.aiApiKey).toBe("sk-plain");
    } finally {
      process.env.HELPLUS_SECRET_KEY = "a1".repeat(32);
      warn.mockRestore();
    }
  });

  it("reports nothing when everything decrypts", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings, twilioToken: encryptSecret("tw") });
    expect((await getSettingsWithStatus()).undecryptable).toEqual([]);
  });
});

describe("reencryptSecrets", () => {
  it("stops before writing when a stored secret can't be decrypted", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings, twilioToken: encryptSecret("tw") });
    process.env.HELPLUS_SECRET_KEY = "b2".repeat(32);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(reencryptSecrets()).rejects.toThrow(/twilioToken/);
      expect(mockPrisma.settings.upsert).toHaveBeenCalledTimes(1);
      expect(mockPrisma.settings.upsert.mock.calls[0][0].update).toEqual({});
    } finally {
      process.env.HELPLUS_SECRET_KEY = "a1".repeat(32);
      warn.mockRestore();
    }
  });

  it("re-saves every non-empty secret encrypted", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings, smtpPass: "", twilioToken: encryptSecret("tw") });
    mockPrisma.settings.findUnique.mockResolvedValue(null);
    const count = await reencryptSecrets();
    const written = mockPrisma.settings.upsert.mock.calls[1][0].update;
    expect(written).not.toHaveProperty("smtpPass");
    expect(isEncrypted(written.aiApiKey)).toBe(true);
    expect(isEncrypted(written.twilioToken)).toBe(true);
    expect(count).toBe(Object.keys(written).length);
  });
});
