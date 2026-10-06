import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { systemPrisma } from "@/lib/prisma";

const C = "it-2a-ticket-move";

vi.mock("@/lib/route-auth", () => ({
  requireAuth: vi.fn(async () => ({
    userId: "nobody",
    role: "admin",
    username: "a",
    name: "Admin",
    authMethod: "cookie",
    companyId: C,
  })),
  isAuthenticated: () => true,
}));

let from = "";
let to = "";
let conv = "";
let rule = "";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: C } });
  await systemPrisma.company.create({ data: { id: C, name: "Ticket move", slug: C } });
  from = (await systemPrisma.project.create({ data: { companyId: C, name: "From" } })).id;
  to = (await systemPrisma.project.create({ data: { companyId: C, name: "To" } })).id;
  conv = (await systemPrisma.conversation.create({ data: { companyId: C, channel: "web" } })).id;
  await systemPrisma.ticket.createMany({
    data: [
      { id: "it-2a-move-old", companyId: C, number: 1, title: "old", description: "x", projectId: from, conversationId: conv, status: "closed" },
      { id: "it-2a-move-new", companyId: C, number: 2, title: "new", description: "x", projectId: from, conversationId: conv },
      { id: "it-2a-move-open", companyId: C, number: 3, title: "open", description: "x", projectId: from, conversationId: conv, status: "working" },
    ],
  });
  rule = (await systemPrisma.sLARule.create({ data: { companyId: C, name: "to", projectId: to, firstResponseMins: 30, resolutionMins: 600 } })).id;
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: C } });
  await systemPrisma.$disconnect();
});

describe("moving a ticket to another project", () => {
  it("takes the other tickets on its conversation with it", async () => {
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const req = new NextRequest("http://localhost/api/tickets/it-2a-move-new", {
      method: "PATCH",
      body: JSON.stringify({ projectId: to }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: "it-2a-move-new" }) });
    expect(res.status).toBe(200);
    const rows = await systemPrisma.ticket.findMany({ where: { conversationId: conv }, select: { projectId: true } });
    expect(rows.map((r) => r.projectId)).toEqual([to, to, to]);
  });

  it("gives open siblings the new project's rule and leaves closed ones alone", async () => {
    const [open, closed] = await Promise.all(
      ["it-2a-move-open", "it-2a-move-old"].map((id) => systemPrisma.ticket.findUniqueOrThrow({ where: { id } }))
    );
    expect(open.slaRuleId).toBe(rule);
    expect(open.resolveDueAt).not.toBeNull();
    expect(closed.slaRuleId).toBeNull();
  });
});
