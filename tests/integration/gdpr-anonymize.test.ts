import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { deleteCustomerData } from "@/lib/gdpr";
import { openTicket } from "@/lib/tickets/service";

const C = "it-2a-gdpr";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: C } });
  await systemPrisma.company.create({ data: { id: C, name: "Gdpr", slug: C } });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: C } });
  await systemPrisma.$disconnect();
});

describe("anonymizing a customer", () => {
  it("redacts the title and description of their tickets", async () => {
    const ticket = await runWithCompany(C, async () => {
      const cust = await prisma.customer.create({ data: { name: "Aminah" } });
      const conv = await prisma.conversation.create({ data: { channel: "whatsapp", customerId: cust.id } });
      await prisma.message.create({ data: { conversationId: conv.id, role: "customer", content: "rumah saya di Jalan 5" } });
      const t = await openTicket({ conversationId: conv.id, title: "Aminah tak boleh login", description: "rumah saya di Jalan 5", source: "whatsapp" });
      const res = await deleteCustomerData(cust.id);
      expect(res.success).toBe(true);
      return t;
    });
    const after = await systemPrisma.ticket.findUnique({ where: { id: ticket.id } });
    const msgs = await systemPrisma.message.findMany({ where: { conversationId: ticket.conversationId! } });
    expect(msgs[0].content).toBe("[REDACTED - GDPR]");
    expect(after?.title).toBe("[REDACTED - GDPR]");
    expect(after?.description).toBe("[REDACTED - GDPR]");
  });
});
