import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createRequest, parseJsonResponse } from "../helpers/request";
import { fixtures } from "../helpers/fixtures";

vi.mock("@/lib/ai/provider", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/provider")>()),
  chatCompletion: vi.fn().mockRejectedValue(new Error("401 Incorrect API key provided: sk-abc123")),
}));

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

describe("POST /api/knowledge/test", () => {
  it("hides provider error details from the response", async () => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings });
    mockPrisma.knowledgeEntry.findMany.mockResolvedValue([
      { id: "k1", title: "Hours", content: "9 to 5", category: { id: "c1", name: "General", color: "#000" } },
    ]);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("@/app/api/knowledge/test/route");
    const response = await POST(createRequest("/api/knowledge/test", { method: "POST", body: { question: "When are you open?" } }));
    const data = await parseJsonResponse(response);

    expect(response.status).toBe(500);
    expect(JSON.stringify(data)).not.toContain("sk-abc123");
    expect(errorLog.mock.calls.flat().join(" ")).toContain("Incorrect API key");
    errorLog.mockRestore();
  });
});
