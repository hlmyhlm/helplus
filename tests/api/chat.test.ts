import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequest, parseJsonResponse } from "../helpers/request";

vi.mock("@/lib/ai/engine", () => ({
  chat: vi.fn().mockResolvedValue("AI response here"),
  createNewConversation: vi.fn().mockResolvedValue({ id: "new-conv-1" }),
}));

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should return AI response for valid message", async () => {
    const { chat, createNewConversation } = await import("@/lib/ai/engine");
    (chat as ReturnType<typeof vi.fn>).mockResolvedValue("Hello! How can I help?");
    (createNewConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "conv-new" });

    const { POST } = await import("@/app/api/chat/route");
    const request = createRequest("/api/chat", {
      method: "POST",
      body: { message: "Hello" },
    });

    const response = await POST(request);
    const data = await parseJsonResponse(response);

    expect(response.status).toBe(200);
    expect(data.conversationId).toBe("conv-new");
    expect(data.response).toBe("Hello! How can I help?");
  });

  it("should reject empty message", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const request = createRequest("/api/chat", {
      method: "POST",
      body: { message: "" },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("should reject missing message", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const request = createRequest("/api/chat", {
      method: "POST",
      body: {},
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("should reject message exceeding 10000 characters", async () => {
    const { POST } = await import("@/app/api/chat/route");
    const request = createRequest("/api/chat", {
      method: "POST",
      body: { message: "A".repeat(10001) },
    });

    const response = await POST(request);
    const data = await parseJsonResponse(response);

    expect(response.status).toBe(400);
    expect(data.error).toContain("10000");
  });

  it("should use provided conversationId", async () => {
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.conversation.findUnique).mockResolvedValue({ id: "existing-conv" } as never);
    const { chat } = await import("@/lib/ai/engine");
    (chat as ReturnType<typeof vi.fn>).mockResolvedValue("Response");

    const { POST } = await import("@/app/api/chat/route");
    const request = createRequest("/api/chat", {
      method: "POST",
      body: { message: "Hello", conversationId: "existing-conv" },
    });

    const response = await POST(request);
    const data = await parseJsonResponse(response);

    expect(data.conversationId).toBe("existing-conv");
    expect(chat).toHaveBeenCalledWith("existing-conv", "Hello");
  });

  it("should handle AI engine errors gracefully", async () => {
    const { chat, createNewConversation } = await import("@/lib/ai/engine");
    (createNewConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "conv-err" });
    (chat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("OpenAI unavailable"));

    const { POST } = await import("@/app/api/chat/route");
    const request = createRequest("/api/chat", {
      method: "POST",
      body: { message: "Hello" },
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
  });

  describe("staff limited to p1", () => {
    const asStaff = async () => {
      const { requireAuth } = await import("@/lib/route-auth");
      vi.mocked(requireAuth).mockResolvedValueOnce({
        userId: "s1",
        role: "staff",
        username: "s",
        name: "S",
        authMethod: "cookie",
        companyId: "test-company",
      } as never);
      const { prisma } = await import("@/lib/prisma");
      vi.mocked(prisma.projectAccess.findMany).mockResolvedValue([{ projectId: "p1" }] as never);
      // the db drops the row when the project filter doesn't match
      vi.mocked(prisma.conversation.findUnique).mockReset();
      vi.mocked(prisma.conversation.findUnique).mockImplementation((async ({ where }: { where: { id: string } }) =>
        where.id === "mine" ? { id: "mine" } : null) as never);
    };

    it("can't chat on another project's conversation", async () => {
      await asStaff();
      const { chat } = await import("@/lib/ai/engine");
      vi.mocked(chat).mockClear();
      const { POST } = await import("@/app/api/chat/route");
      const res = await POST(createRequest("/api/chat", { method: "POST", body: { message: "hi", conversationId: "theirs" } }));
      expect(res.status).toBe(404);
      expect(chat).not.toHaveBeenCalled();
      const { prisma } = await import("@/lib/prisma");
      expect(vi.mocked(prisma.conversation.findUnique).mock.calls[0][0]).toMatchObject({
        where: { id: "theirs", tickets: { some: { projectId: { in: ["p1"] } } } },
      });
    });

    it("can chat on a conversation in their project", async () => {
      await asStaff();
      const { chat } = await import("@/lib/ai/engine");
      vi.mocked(chat).mockResolvedValue("ok");
      const { POST } = await import("@/app/api/chat/route");
      const res = await POST(createRequest("/api/chat", { method: "POST", body: { message: "hi", conversationId: "mine" } }));
      expect(res.status).toBe(200);
      expect(chat).toHaveBeenCalledWith("mine", "hi");
    });
  });
});
