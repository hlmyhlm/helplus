import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { systemPrisma } from "@/lib/prisma";

const C = "it-2a-conv-access";
let staffId = "";
let allowedConv = "";
let otherConv = "";

vi.mock("@/lib/route-auth", () => ({
  requireAuth: vi.fn(async () => ({
    userId: staffId,
    role: "staff",
    username: "s",
    name: "Staff",
    authMethod: "cookie",
    companyId: C,
  })),
  isAuthenticated: () => true,
}));

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: C } });
  await systemPrisma.company.create({ data: { id: C, name: "Conv access", slug: C } });
  const p1 = await systemPrisma.project.create({ data: { companyId: C, name: "P1" } });
  const p2 = await systemPrisma.project.create({ data: { companyId: C, name: "P2" } });
  const staff = await systemPrisma.admin.create({
    data: { companyId: C, username: "it-2a-conv-access-staff", password: "x", role: "staff" },
  });
  staffId = staff.id;
  await systemPrisma.projectAccess.create({ data: { companyId: C, projectId: p1.id, adminId: staff.id } });

  const a = await systemPrisma.conversation.create({ data: { companyId: C, channel: "web", customerName: "Allowed" } });
  const b = await systemPrisma.conversation.create({ data: { companyId: C, channel: "web", customerName: "Other" } });
  allowedConv = a.id;
  otherConv = b.id;
  await systemPrisma.ticket.createMany({
    data: [
      { companyId: C, number: 1, title: "a", description: "a", projectId: p1.id, conversationId: a.id },
      { companyId: C, number: 2, title: "b", description: "b", projectId: p2.id, conversationId: b.id },
    ],
  });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: C } });
  await systemPrisma.$disconnect();
});

describe("conversations for staff with one project", () => {
  it("lists only the conversation with a ticket in their project", async () => {
    const { GET } = await import("@/app/api/conversations/route");
    const res = await GET(new NextRequest("http://localhost/api/conversations"), undefined as never);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.map((c: { id: string }) => c.id)).toEqual([allowedConv]);
    expect(body.pagination.total).toBe(1);
  });

  it("gets 404 on the other one", async () => {
    const { GET } = await import("@/app/api/conversations/[id]/route");
    const ok = await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id: allowedConv }) });
    const hidden = await GET(new NextRequest("http://localhost/x"), { params: Promise.resolve({ id: otherConv }) });
    expect(ok.status).toBe(200);
    expect(hidden.status).toBe(404);
  });
});
