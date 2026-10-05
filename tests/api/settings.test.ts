import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { createRequest, parseJsonResponse } from "../helpers/request";
import { fixtures } from "../helpers/fixtures";
import { SECRET_FIELDS } from "@/lib/security";
import { runWithCompany } from "@/lib/tenant/context";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

describe("GET /api/settings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return settings with secrets masked", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings });

    const { GET } = await import("@/app/api/settings/route");
    const response = await GET();
    const data = await parseJsonResponse(response);

    expect(response.status).toBe(200);
    expect(data.businessName).toBe("Test Business");

    // All secret fields must be masked
    for (const field of SECRET_FIELDS) {
      expect(data[field]).toBe("***");
    }
  });

  it("should not leak raw API keys", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings });

    const { GET } = await import("@/app/api/settings/route");
    const response = await GET();
    const data = await parseJsonResponse(response);
    const jsonString = JSON.stringify(data);

    // Ensure no actual secret values appear in response
    expect(jsonString).not.toContain("sk-test-key-12345");
    expect(jsonString).not.toContain("smtp-password");
    expect(jsonString).not.toContain("imap-password");
    expect(jsonString).not.toContain("twilio-auth-token");
    expect(jsonString).not.toContain("el-key-12345");
    expect(jsonString).not.toContain("wa-key-12345");
  });

  it("should create default settings if none exist", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({
      id: "default",
      businessName: "",
      aiApiKey: "",
    });

    const { GET } = await import("@/app/api/settings/route");
    const response = await runWithCompany("test-company", () => GET());

    expect(response.status).toBe(200);
    expect(mockPrisma.settings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: "test-company" }, create: {} })
    );
  });

  it("should handle database errors", async () => {
    mockPrisma.settings.upsert.mockRejectedValue(new Error("DB error"));

    const { GET } = await import("@/app/api/settings/route");
    const response = await GET();

    expect(response.status).toBe(500);
  });
});

describe("PUT /api/settings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockPrisma.settings.findUnique.mockReset();
    mockPrisma.settings.findUnique.mockResolvedValue({ ...fixtures.settings });
  });

  it("should update settings with valid data", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({
      ...fixtures.settings,
      businessName: "Updated Business",
    });

    const { PUT } = await import("@/app/api/settings/route");
    const request = createRequest("/api/settings", {
      method: "PUT",
      body: { businessName: "Updated Business", tone: "formal" },
    });

    const response = await PUT(request);
    expect(response.status).toBe(200);
  });

  it("should reject invalid tone value", async () => {
    const { PUT } = await import("@/app/api/settings/route");
    const request = createRequest("/api/settings", {
      method: "PUT",
      body: { tone: "super-casual" },
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  it("should reject unknown fields", async () => {
    const { PUT } = await import("@/app/api/settings/route");
    const request = createRequest("/api/settings", {
      method: "PUT",
      body: { businessName: "Test", hackField: "malicious" },
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  it("says why when the encryption key is missing", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings });
    const saved = process.env.HELPLUS_SECRET_KEY;
    delete process.env.HELPLUS_SECRET_KEY;
    try {
      const { PUT } = await import("@/app/api/settings/route");
      const request = createRequest("/api/settings", {
        method: "PUT",
        body: { aiApiKey: "sk-new" },
      });
      const response = await PUT(request);
      const data = await parseJsonResponse(response);
      expect(response.status).toBe(500);
      expect(data.error).toBe("Server encryption key is missing or invalid. Set HELPLUS_SECRET_KEY.");
    } finally {
      process.env.HELPLUS_SECRET_KEY = saved;
    }
  });

  it("should mask secrets in response after update", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({
      ...fixtures.settings,
      businessName: "Updated",
    });

    const { PUT } = await import("@/app/api/settings/route");
    const request = createRequest("/api/settings", {
      method: "PUT",
      body: { businessName: "Updated" },
    });

    const response = await PUT(request);
    const data = await parseJsonResponse(response);

    for (const field of SECRET_FIELDS) {
      expect(data[field]).toBe("***");
    }
  });
});
