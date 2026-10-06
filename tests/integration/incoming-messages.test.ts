import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { chat } from "@/lib/ai/engine";

const A = "it-2a-in";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "A", slug: A } });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
});

describe("incoming channel messages", () => {
  it("become a ticket even without AI, with IC hidden", async () => {
    const reply = await runWithCompany(A, async () => {
      const conv = await prisma.conversation.create({ data: { channel: "whatsapp", customerName: "Ali" } });
      const answer = await chat(conv.id, "IC 900101145678 tak boleh semak");
      const tickets = await prisma.ticket.findMany({ where: { conversationId: conv.id } });
      const messages = await prisma.message.findMany({ where: { conversationId: conv.id } });
      expect(tickets).toHaveLength(1);
      expect(tickets[0].title).toBe("IC [IC HIDDEN] tak boleh semak");
      expect(messages[0].content).toBe("IC [IC HIDDEN] tak boleh semak");
      return answer;
    });
    expect(reply).toMatch(/AI is not configured/);
  });
});
