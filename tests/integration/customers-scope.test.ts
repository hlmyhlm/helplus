import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { customerWhere } from "@/lib/tickets/access";

const C = "it-2b-customers-scope";

let inProject = "";
let viaTicket = "";
let outside = "";
let p1Id = "";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: C } });
  await systemPrisma.company.create({ data: { id: C, name: "Customers scope", slug: C } });
  const p1 = await systemPrisma.project.create({ data: { companyId: C, name: "P1" } });
  const p2 = await systemPrisma.project.create({ data: { companyId: C, name: "P2" } });
  p1Id = p1.id;

  const a = await systemPrisma.customer.create({ data: { companyId: C, name: "In project", projectId: p1.id } });
  const b = await systemPrisma.customer.create({ data: { companyId: C, name: "Via ticket" } });
  const c = await systemPrisma.customer.create({ data: { companyId: C, name: "Outside", projectId: p2.id } });
  inProject = a.id;
  viaTicket = b.id;
  outside = c.id;

  const conv = await systemPrisma.conversation.create({ data: { companyId: C, channel: "web", customerId: b.id } });
  await systemPrisma.ticket.create({
    data: { companyId: C, number: 1, title: "x", description: "x", projectId: p1.id, conversationId: conv.id },
  });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: C } });
  await systemPrisma.$disconnect();
});

describe("customerWhere, with real rows", () => {
  it("shows a customer's own project and one reached through a ticket, not one in another project", async () => {
    const rows = await runWithCompany(C, () => prisma.customer.findMany({ where: customerWhere([p1Id]) }));
    expect(rows.map((r) => r.id).sort()).toEqual([inProject, viaTicket].sort());
    expect(rows.map((r) => r.id)).not.toContain(outside);
  });
});
