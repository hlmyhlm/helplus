import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { systemPrisma } from "@/lib/prisma";

const A = "it-3b-drafts-a";
const B = "it-3b-drafts-b";
let ownDraft = "";
let otherDraft = "";

vi.mock("@/lib/route-auth", () => ({
  requireAuth: vi.fn(async () => ({
    userId: "it-3b-drafts-owner",
    role: "owner",
    username: "o",
    name: "Owner",
    authMethod: "cookie",
    companyId: A,
  })),
  isAuthenticated: () => true,
}));

const req = (id: string, method: string, body: Record<string, unknown>) =>
  new NextRequest(`http://localhost/api/knowledge/drafts/${id}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  for (const id of [A, B]) {
    await systemPrisma.company.create({ data: { id, name: id, slug: id } });
  }
  const catA = await systemPrisma.category.create({ data: { companyId: A, name: "Imported" } });
  const catB = await systemPrisma.category.create({ data: { companyId: B, name: "Imported" } });
  const draft = { title: "Q", content: "Q: q\n\nA: a", status: "draft", isActive: false };
  ownDraft = (
    await systemPrisma.knowledgeEntry.create({
      data: { ...draft, companyId: A, categoryId: catA.id },
    })
  ).id;
  otherDraft = (
    await systemPrisma.knowledgeEntry.create({
      data: { ...draft, companyId: B, categoryId: catB.id },
    })
  ).id;
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("drafts across companies", () => {
  it("404s on PATCH and POST for another company's draft and leaves it alone", async () => {
    const { PATCH, POST } = await import("@/app/api/knowledge/drafts/[id]/route");

    expect(
      (await PATCH(req(otherDraft, "PATCH", { title: "hijack" }), ctx(otherDraft))).status
    ).toBe(404);
    expect(
      (await POST(req(otherDraft, "POST", { action: "approve" }), ctx(otherDraft))).status
    ).toBe(404);
    expect(
      (await POST(req(otherDraft, "POST", { action: "reject" }), ctx(otherDraft))).status
    ).toBe(404);

    const row = await systemPrisma.knowledgeEntry.findUnique({ where: { id: otherDraft } });
    expect(row).toMatchObject({ title: "Q", status: "draft", isActive: false });
  });

  it("approves its own draft once, then 409s", async () => {
    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");

    expect((await POST(req(ownDraft, "POST", { action: "approve" }), ctx(ownDraft))).status).toBe(
      200
    );
    expect((await POST(req(ownDraft, "POST", { action: "approve" }), ctx(ownDraft))).status).toBe(
      409
    );
    expect((await POST(req(ownDraft, "POST", { action: "reject" }), ctx(ownDraft))).status).toBe(
      409
    );

    const row = await systemPrisma.knowledgeEntry.findUnique({ where: { id: ownDraft } });
    expect(row).toMatchObject({ status: "approved", isActive: true });
  });
});
