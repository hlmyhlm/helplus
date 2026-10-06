import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest, parseJsonResponse } from "../helpers/request";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ctx = { params: Promise.resolve({ id: "cust-1" }) };

const asRole = (role: string) =>
  vi.mocked(requireAuth).mockResolvedValue({
    userId: "u1",
    role,
    username: "u",
    name: "U",
    authMethod: "cookie",
    companyId: "test-company",
  } as never);

beforeEach(() => {
  for (const m of ["customer", "customerNote", "conversation", "projectAccess"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  asRole("admin");
});

describe("GET /api/customers", () => {
  it("staff limited to p1 only see customers scoped to their projects", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.customer.findMany.mockResolvedValue([]);
    db.customer.count.mockResolvedValue(0);

    const { GET } = await import("@/app/api/customers/route");
    await GET(createRequest("/api/customers"), {} as never);

    const where = db.customer.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"projectId":{"in":["p1"]}');
  });

  it("combines a search filter with project scope via AND", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.customer.findMany.mockResolvedValue([]);
    db.customer.count.mockResolvedValue(0);

    const { GET } = await import("@/app/api/customers/route");
    await GET(createRequest("/api/customers", { searchParams: { search: "john" } }), {} as never);

    const where = db.customer.findMany.mock.calls[0][0].where;
    expect(where.OR).toBeUndefined();
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0].OR[0]).toMatchObject({ name: { contains: "john", mode: "insensitive" } });
    expect(where.AND[1]).toMatchObject({ OR: expect.any(Array) });
  });
});

describe("GET /api/customers/:id", () => {
  it("404s when the customer is outside the staff member's projects", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.customer.findFirst.mockResolvedValue(null);

    const { GET } = await import("@/app/api/customers/[id]/route");
    const res = await GET(createRequest("/api/customers/cust-1"), ctx);
    expect(res.status).toBe(404);
  });

  it("returns the customer when it is in an allowed project", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.customer.findFirst.mockResolvedValue({ id: "cust-1", name: "A", email: "", phone: "", whatsapp: "" });
    db.conversation.findMany.mockResolvedValue([]);

    const { GET } = await import("@/app/api/customers/[id]/route");
    const res = await GET(createRequest("/api/customers/cust-1"), ctx);
    expect(res.status).toBe(200);
    const body = await parseJsonResponse(res);
    expect(body.id).toBe("cust-1");
  });
});

describe("PUT /api/customers/:id", () => {
  it("404s when outside the staff member's projects", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.customer.findFirst.mockResolvedValue(null);

    const { PUT } = await import("@/app/api/customers/[id]/route");
    const res = await PUT(createRequest("/api/customers/cust-1", { method: "PUT", body: { name: "New" } }), ctx);
    expect(res.status).toBe(404);
    expect(db.customer.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/customers/:id", () => {
  it("404s when outside the staff member's projects", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.customer.findFirst.mockResolvedValue(null);

    const { DELETE } = await import("@/app/api/customers/[id]/route");
    const res = await DELETE(createRequest("/api/customers/cust-1", { method: "DELETE" }), ctx);
    expect(res.status).toBe(404);
    expect(db.customer.delete).not.toHaveBeenCalled();
  });
});

describe("notes", () => {
  it("GET and POST 404 when the customer is outside the staff member's projects", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.customer.findFirst.mockResolvedValue(null);

    const { GET, POST } = await import("@/app/api/customers/[id]/notes/route");
    expect((await GET(createRequest("/api/customers/cust-1/notes"), ctx)).status).toBe(404);
    const res = await POST(createRequest("/api/customers/cust-1/notes", { method: "POST", body: { content: "x" } }), ctx);
    expect(res.status).toBe(404);
    expect(db.customerNote.create).not.toHaveBeenCalled();
  });
});
