import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest, parseJsonResponse } from "../helpers/request";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const params = { params: Promise.resolve({ id: "r1" }) };

beforeEach(() => {
  for (const m of ["sLARule", "project", "projectAccess"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  vi.mocked(requireAuth).mockResolvedValue({
    userId: "u1",
    role: "admin",
    username: "u",
    name: "U",
    authMethod: "cookie",
    companyId: "test-company",
  } as never);
});

describe("sla rules", () => {
  it("lists rules with their project", async () => {
    db.sLARule.findMany.mockResolvedValue([]);
    db.sLARule.count.mockResolvedValue(0);
    const { GET } = await import("@/app/api/sla/route");
    await GET(createRequest("/api/sla"), {} as never);
    expect(db.sLARule.findMany.mock.calls[0][0].include).toEqual({ project: { select: { id: true, name: true } } });
  });

  it("shows admins every rule", async () => {
    db.sLARule.findMany.mockResolvedValue([]);
    db.sLARule.count.mockResolvedValue(0);
    const { GET } = await import("@/app/api/sla/route");
    await GET(createRequest("/api/sla"), {} as never);
    expect(db.sLARule.findMany.mock.calls[0][0].where).toEqual({});
    expect(db.sLARule.count.mock.calls[0][0]).toEqual({ where: {} });
  });

  it("shows staff only general rules and their own projects", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ userId: "u2", role: "staff", username: "s", name: "S", authMethod: "cookie", companyId: "test-company" } as never);
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.sLARule.findMany.mockResolvedValue([]);
    db.sLARule.count.mockResolvedValue(0);
    const { GET } = await import("@/app/api/sla/route");
    await GET(createRequest("/api/sla"), {} as never);
    const where = { OR: [{ projectId: null }, { projectId: { in: ["p1"] } }] };
    expect(db.sLARule.findMany.mock.calls[0][0].where).toEqual(where);
    expect(db.sLARule.count.mock.calls[0][0]).toEqual({ where });
  });

  it("creates a rule with source, project and category", async () => {
    db.project.findFirst.mockResolvedValue({ id: "p1" });
    db.sLARule.create.mockImplementation(async ({ data }: { data: unknown }) => ({ id: "r1", ...(data as object) }));
    const { POST } = await import("@/app/api/sla/route");
    const res = await POST(
      createRequest("/api/sla", {
        method: "POST",
        body: { name: " Urgent ", projectId: "p1", priority: "urgent", source: "whatsapp", firstResponseMins: 15, resolutionMins: 120 },
      }),
      {} as never
    );
    expect(res.status).toBe(201);
    expect(db.sLARule.create.mock.calls[0][0].data).toMatchObject({
      name: "Urgent",
      projectId: "p1",
      priority: "urgent",
      category: "all",
      source: "whatsapp",
      firstResponseMins: 15,
      resolutionMins: 120,
      isActive: true,
    });
  });

  it("rejects a bad body", async () => {
    const { POST } = await import("@/app/api/sla/route");
    const res = await POST(
      createRequest("/api/sla", { method: "POST", body: { name: "x", priority: "asap", firstResponseMins: 0, resolutionMins: 60 } }),
      {} as never
    );
    expect(res.status).toBe(400);
    expect(db.sLARule.create).not.toHaveBeenCalled();
  });

  it("refuses a project that doesn't exist", async () => {
    db.project.findFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/sla/route");
    const res = await POST(
      createRequest("/api/sla", { method: "POST", body: { name: "x", projectId: "nope", firstResponseMins: 15, resolutionMins: 120 } }),
      {} as never
    );
    expect(res.status).toBe(400);
    expect((await parseJsonResponse(res)).error).toBe("Project not found");
    expect(db.sLARule.create).not.toHaveBeenCalled();
  });

  it("an update only touches the fields sent", async () => {
    db.sLARule.findUnique.mockResolvedValue({ id: "r1" });
    db.sLARule.update.mockResolvedValue({ id: "r1" });
    const { PUT } = await import("@/app/api/sla/[id]/route");
    const res = await PUT(createRequest("/api/sla/r1", { method: "PUT", body: { resolutionMins: 240 } }), params);
    expect(res.status).toBe(200);
    expect(db.sLARule.update.mock.calls[0][0].data).toEqual({ resolutionMins: 240 });
  });

  it("an update checks a new project", async () => {
    db.sLARule.findUnique.mockResolvedValue({ id: "r1" });
    db.project.findFirst.mockResolvedValue(null);
    const { PUT } = await import("@/app/api/sla/[id]/route");
    const res = await PUT(createRequest("/api/sla/r1", { method: "PUT", body: { projectId: "nope" } }), params);
    expect(res.status).toBe(400);
    expect(db.sLARule.update).not.toHaveBeenCalled();
  });
});
