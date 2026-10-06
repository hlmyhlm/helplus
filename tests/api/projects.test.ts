import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest, parseJsonResponse } from "../helpers/request";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
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
  for (const m of ["project", "projectAccess", "ticket", "customer", "admin", "settings"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction.mockReset();
  asRole("admin");
});

describe("projects", () => {
  it("lists projects with open ticket and people counts", async () => {
    db.project.findMany.mockResolvedValue([{ id: "p1", name: "General", isDefault: true, archived: false }]);
    db.ticket.groupBy.mockResolvedValue([{ projectId: "p1", _count: { _all: 3 } }]);
    db.customer.groupBy.mockResolvedValue([{ projectId: "p1", _count: { _all: 2 } }]);
    const { GET } = await import("@/app/api/projects/route");
    const body = await parseJsonResponse(await GET(createRequest("/api/projects"), {} as never));
    expect(body.data[0]).toMatchObject({ id: "p1", openTickets: 3, people: 2 });
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "projects:read");
  });

  it("staff only see their projects", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.project.findMany.mockResolvedValue([]);
    db.ticket.groupBy.mockResolvedValue([]);
    db.customer.groupBy.mockResolvedValue([]);
    const { GET } = await import("@/app/api/projects/route");
    await GET(createRequest("/api/projects"), {} as never);
    expect(JSON.stringify(db.project.findMany.mock.calls[0][0].where)).toContain('"id":{"in":["p1"]}');
  });

  it("checks the manage permission before creating", async () => {
    const { POST } = await import("@/app/api/projects/route");
    await POST(createRequest("/api/projects", { method: "POST", body: { name: "Alpha" } }), {} as never);
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "projects:manage");
  });

  it("a duplicate name is a 409", async () => {
    db.project.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const { POST } = await import("@/app/api/projects/route");
    const res = await POST(createRequest("/api/projects", { method: "POST", body: { name: "General" } }), {} as never);
    expect(res.status).toBe(409);
  });

  it("the default project can't be archived", async () => {
    db.project.findUnique.mockResolvedValue({ id: "p1", isDefault: true });
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const res = await PATCH(
      createRequest("/api/projects/p1", { method: "PATCH", body: { archived: true } }),
      { params: Promise.resolve({ id: "p1" }) }
    );
    expect(res.status).toBe(400);
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "projects:manage");
  });

  it("replaces the staff list of a project", async () => {
    db.project.findUnique.mockResolvedValue({ id: "p1" });
    db.admin.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db));
    const { PUT } = await import("@/app/api/projects/[id]/access/route");
    const res = await PUT(
      createRequest("/api/projects/p1/access", { method: "PUT", body: { adminIds: ["a1", "a2"] } }),
      { params: Promise.resolve({ id: "p1" }) }
    );
    expect(res.status).toBe(200);
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "projects:manage");
    expect(db.projectAccess.deleteMany).toHaveBeenCalledWith({ where: { projectId: "p1" } });
    expect(db.projectAccess.createMany).toHaveBeenCalledWith({
      data: [
        { projectId: "p1", adminId: "a1" },
        { projectId: "p1", adminId: "a2" },
      ],
    });
  });

  it("access list 404s when the project doesn't exist", async () => {
    db.project.findUnique.mockResolvedValue(null);
    const { GET } = await import("@/app/api/projects/[id]/access/route");
    const res = await GET(createRequest("/api/projects/p1/access"), { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(404);
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "projects:manage");
  });
});

describe("company info", () => {
  it("returns the label and no manage permission for a viewer", async () => {
    asRole("viewer");
    db.settings.upsert.mockResolvedValue({ projectLabel: "Projects", businessName: "Acme" });
    db.company.findFirst.mockResolvedValue({ name: "Acme Sdn Bhd", slug: "acme" });
    const { GET } = await import("@/app/api/company/route");
    const body = await parseJsonResponse(await GET(createRequest("/api/company"), {} as never));
    expect(body).toEqual({ name: "Acme Sdn Bhd", slug: "acme", projectLabel: "Projects", canManageProjects: false });
  });

  it("returns canManageProjects true for an admin", async () => {
    asRole("admin");
    db.settings.upsert.mockResolvedValue({ projectLabel: "Projects", businessName: "Acme" });
    db.company.findFirst.mockResolvedValue({ name: "Acme Sdn Bhd", slug: "acme" });
    const { GET } = await import("@/app/api/company/route");
    const body = await parseJsonResponse(await GET(createRequest("/api/company"), {} as never));
    expect(body.canManageProjects).toBe(true);
  });
});
