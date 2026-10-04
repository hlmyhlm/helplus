import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { parseJsonResponse } from "../helpers/request";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>> | ReturnType<typeof vi.fn>>;

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock settings for AI provider check
    (mockPrisma.settings as Record<string, ReturnType<typeof vi.fn>>).upsert.mockResolvedValue({ aiApiKey: "" });
  });

  it("should return ok status when database is connected", async () => {
    (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ "?column?": 1 }]);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const data = await parseJsonResponse(response);

    expect(response.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.services.database).toBe("connected");
    expect(data.uptime).toBeDefined();
    expect(data.memory).toBeDefined();
    expect(data.environment).toBeDefined();
  });

  it("should return degraded status when database is down", async () => {
    (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Connection refused"));

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const data = await parseJsonResponse(response);

    expect(response.status).toBe(200);
    expect(data.status).toBe("degraded");
    expect(data.services.database).toBe("error");
  });

  it("should report ai as not_configured when no API key", async () => {
    (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ "?column?": 1 }]);
    (mockPrisma.settings as Record<string, ReturnType<typeof vi.fn>>).upsert.mockResolvedValue({ aiApiKey: "" });

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const data = await parseJsonResponse(response);

    expect(data.services.ai).toBe("not_configured");
  });

  it("should report ai as reachable when the API responds ok", async () => {
    (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ "?column?": 1 }]);
    (mockPrisma.settings as Record<string, ReturnType<typeof vi.fn>>).upsert.mockResolvedValue({ aiApiKey: "sk-test" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const data = await parseJsonResponse(response);

    expect(data.services.ai).toBe("reachable");

    vi.unstubAllGlobals();
  });

  it("should report ai as not_configured for a custom provider with no base url, without making a request", async () => {
    (mockPrisma.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ "?column?": 1 }]);
    (mockPrisma.settings as Record<string, ReturnType<typeof vi.fn>>).upsert.mockResolvedValue({
      aiApiKey: "key",
      aiProvider: "custom",
      aiBaseUrl: "",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const data = await parseJsonResponse(response);

    expect(data.services.ai).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
