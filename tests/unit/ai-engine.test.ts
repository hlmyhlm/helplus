import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";

// callers always run inside a company, so the tests do too
const inCompany = (fn: () => Promise<void>) => () => runWithCompany("test-company", fn);

// Mock OpenAI
const mockOpenAICreateFn = vi.fn();
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockOpenAICreateFn,
        },
      };
    },
  };
});

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

describe("AI Engine", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    // ticket.update's call history leaks across tests otherwise
    mockPrisma.ticket.update.mockClear();
    mockOpenAICreateFn.mockReset();

    // Default settings
    mockPrisma.settings.upsert.mockResolvedValue({
      id: "default",
      businessName: "Test Biz",
      businessDesc: "A test business",
      welcomeMessage: "Hello!",
      tone: "friendly",
      language: "auto",
      aiProvider: "openai",
      aiModel: "gpt-4",
      aiApiKey: "sk-test",
      aiBaseUrl: "",
      maxTokens: 1000,
      temperature: 0.7,
    });

    mockPrisma.settings.create.mockResolvedValue({
      id: "default",
      aiApiKey: "",
    });

    // Default knowledge base
    mockPrisma.knowledgeEntry.findMany.mockResolvedValue([]);

    // Default conversation
    mockPrisma.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      channel: "whatsapp",
      customerName: "John",
      customerContact: "+1555",
      status: "active",
      messages: [
        { role: "customer", content: "Hi", createdAt: new Date() },
      ],
    });

    // Default message creation
    mockPrisma.message.create.mockResolvedValue({ id: "msg-new" });
    mockPrisma.conversation.update.mockResolvedValue({});

    // ticketForIncomingMessage finds an open ticket and just touches it
    mockPrisma.ticket.findFirst.mockResolvedValue({ id: "t1" });
    mockPrisma.ticket.update.mockResolvedValue({ id: "t1" });

    // saveTicket's sla lookup, only hit when a status actually changes
    mockPrisma.sLARule.findMany.mockResolvedValue([]);
    mockPrisma.businessHours.findUnique.mockResolvedValue(null);
    mockPrisma.holiday.findMany.mockResolvedValue([]);
  });

  it("should return fallback when AI API key is not configured", inCompany(async () => {
    mockPrisma.settings.upsert.mockResolvedValue({
      id: "default",
      aiApiKey: "",
      aiBaseUrl: "",
      aiProvider: "openai",
      aiModel: "gpt-4",
      maxTokens: 1000,
      temperature: 0.7,
      businessName: "Test",
      businessDesc: "",
      welcomeMessage: "",
      tone: "friendly",
      language: "auto",
    });

    const { chat } = await import("@/lib/ai/engine");
    const response = await chat("conv-1", "Hello");

    expect(response).toContain("AI is not configured");
  }));

  it("should return error when conversation not found", inCompany(async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue(null);

    const { chat } = await import("@/lib/ai/engine");
    const response = await chat("nonexistent", "Hello");

    expect(response).toBe("Conversation not found.");
  }));

  it("should call OpenAI with correct parameters", inCompany(async () => {
    mockOpenAICreateFn.mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "Hello! How can I help?" },
        },
      ],
    });

    const { chat } = await import("@/lib/ai/engine");
    const response = await chat("conv-1", "I need help");

    expect(response).toBe("Hello! How can I help?");
    expect(mockOpenAICreateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4",
        max_tokens: 1000,
        temperature: 0.7,
      })
    );
  }));

  it("hides an IC number from the AI provider", inCompany(async () => {
    const text = "My IC is 900101-14-5678, please check";
    mockPrisma.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      channel: "whatsapp",
      customerName: "John",
      customerContact: "+1555",
      status: "active",
      messages: [{ role: "customer", content: text, createdAt: new Date() }],
    });
    mockOpenAICreateFn.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "Thanks" } }],
    });

    const { chat } = await import("@/lib/ai/engine");
    await chat("conv-1", text);

    const sent = JSON.stringify(mockOpenAICreateFn.mock.calls[0][0].messages);
    expect(sent).toContain("My IC is [IC HIDDEN], please check");
    expect(sent).not.toContain("900101");
  }));

  it("sends staff replies (role agent) to the AI as assistant history", inCompany(async () => {
    mockPrisma.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      channel: "whatsapp",
      customerName: "John",
      customerContact: "+1555",
      status: "active",
      messages: [
        { role: "customer", content: "Hi", createdAt: new Date() },
        { role: "agent", content: "A staff member already told you X", createdAt: new Date() },
      ],
    });
    mockOpenAICreateFn.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "Thanks" } }],
    });

    const { chat } = await import("@/lib/ai/engine");
    await chat("conv-1", "follow up question");

    const sentMessages = mockOpenAICreateFn.mock.calls[0][0].messages;
    const agentMessage = sentMessages.find(
      (m: { content: string }) => m.content === "A staff member already told you X"
    );
    expect(agentMessage?.role).toBe("assistant");
  }));

  it("should save user and assistant messages", inCompany(async () => {
    mockOpenAICreateFn.mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "I can help with that." },
        },
      ],
    });

    const { chat } = await import("@/lib/ai/engine");
    await chat("conv-1", "Help me");

    // User message saved
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: "conv-1",
          role: "customer",
          content: "Help me",
        }),
      })
    );

    // Assistant message saved
    expect(mockPrisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: "conv-1",
          role: "assistant",
          content: "I can help with that.",
        }),
      })
    );
  }));

  it("should include knowledge base in system prompt", inCompany(async () => {
    mockPrisma.knowledgeEntry.findMany.mockResolvedValue([
      {
        category: { name: "FAQ" },
        title: "Return Policy",
        content: "30-day returns allowed",
        priority: 10,
      },
    ]);

    mockOpenAICreateFn.mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "Our return policy..." },
        },
      ],
    });

    const { chat } = await import("@/lib/ai/engine");
    await chat("conv-1", "What is your return policy?");

    const callArgs = mockOpenAICreateFn.mock.calls[0][0];
    const systemMessage = callArgs.messages[0];
    expect(systemMessage.content).toContain("Return Policy");
    expect(systemMessage.content).toContain("30-day returns allowed");
  }));

  it("only reads approved, active knowledge", inCompany(async () => {
    mockOpenAICreateFn.mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: "ok" } }] });

    const { chat } = await import("@/lib/ai/engine");
    await chat("conv-1", "hi");

    const where = mockPrisma.knowledgeEntry.findMany.mock.calls.at(-1)?.[0].where;
    expect(where).toEqual({ isActive: true, status: "approved" });
  }));

  it("should handle tool calls and recurse", inCompany(async () => {
    // First call returns tool_calls
    mockOpenAICreateFn
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              content: "",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "get_customer_history",
                    arguments: JSON.stringify({ customerContact: "+1555" }),
                  },
                },
              ],
            },
          },
        ],
      })
      // Second call returns final response
      .mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: "Based on your history, I can see...",
            },
          },
        ],
      });

    // Mock the customer history tool
    mockPrisma.conversation.findMany.mockResolvedValue([]);

    const { chat } = await import("@/lib/ai/engine");
    const response = await chat("conv-1", "Do you know me?");

    expect(response).toBe("Based on your history, I can see...");
    expect(mockOpenAICreateFn).toHaveBeenCalledTimes(2);
  }));

  it("should return fallback message when content is empty", inCompany(async () => {
    mockOpenAICreateFn.mockResolvedValue({
      choices: [
        {
          finish_reason: "stop",
          message: { content: "" },
        },
      ],
    });

    const { chat } = await import("@/lib/ai/engine");
    const response = await chat("conv-1", "Hello");

    expect(response).toContain("could not generate a response");
  }));

  it("marks a new ticket ai_suggested after a successful reply", inCompany(async () => {
    mockPrisma.ticket.findFirst.mockResolvedValue({ id: "t1", status: "new", firstReplyAt: null, reopenCount: 0 });
    mockPrisma.ticket.update.mockResolvedValue({ id: "t1", status: "new", firstReplyAt: null, reopenCount: 0 });
    mockOpenAICreateFn.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "Here's the answer." } }],
    });

    const { chat } = await import("@/lib/ai/engine");
    await chat("conv-1", "Hello");

    expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1" },
        data: expect.objectContaining({ status: "ai_suggested" }),
      })
    );
  }));

  it("doesn't mark a ticket ai_suggested when the AI call fails", inCompany(async () => {
    mockPrisma.ticket.findFirst.mockResolvedValue({ id: "t1", status: "new", firstReplyAt: null, reopenCount: 0 });
    mockPrisma.ticket.update.mockResolvedValue({ id: "t1", status: "new", firstReplyAt: null, reopenCount: 0 });
    mockOpenAICreateFn.mockRejectedValue(new Error("boom"));

    const { chat } = await import("@/lib/ai/engine");
    await chat("conv-1", "Hello");

    expect(mockPrisma.ticket.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ai_suggested" }) })
    );
  }));

  it("doesn't mark a ticket ai_suggested when the reply content is empty", inCompany(async () => {
    mockPrisma.ticket.findFirst.mockResolvedValue({ id: "t1", status: "new", firstReplyAt: null, reopenCount: 0 });
    mockPrisma.ticket.update.mockResolvedValue({ id: "t1", status: "new", firstReplyAt: null, reopenCount: 0 });
    mockOpenAICreateFn.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "" } }],
    });

    const { chat } = await import("@/lib/ai/engine");
    await chat("conv-1", "Hello");

    expect(mockPrisma.ticket.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ai_suggested" }) })
    );
  }));

  it("doesn't mark a working ticket ai_suggested", inCompany(async () => {
    mockPrisma.ticket.findFirst.mockResolvedValue({ id: "t1", status: "working", firstReplyAt: null, reopenCount: 0 });
    mockPrisma.ticket.update.mockResolvedValue({ id: "t1", status: "working", firstReplyAt: null, reopenCount: 0 });
    mockOpenAICreateFn.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: "Here's the answer." } }],
    });

    const { chat } = await import("@/lib/ai/engine");
    await chat("conv-1", "Hello");

    expect(mockPrisma.ticket.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ai_suggested" }) })
    );
  }));
});
