import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { createTicket } from "@/lib/tickets/service";

const C = "it-2a-cascade";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: C } });
  await systemPrisma.company.create({ data: { id: C, name: "Cascade", slug: C } });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: C } });
  await systemPrisma.$disconnect();
});

describe("deleting a conversation", () => {
  it("deletes its tickets too", async () => {
    const t = await runWithCompany(C, () => createTicket({ text: "printer rosak" }));
    await runWithCompany(C, () => prisma.conversation.delete({ where: { id: t.conversationId! } }));
    expect(await systemPrisma.ticket.findUnique({ where: { id: t.id } })).toBeNull();
  });
});
