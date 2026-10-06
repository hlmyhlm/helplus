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
  for (const m of ["ticket", "projectAccess", "project", "conversation", "message", "ticketCounter", "sLARule", "businessHours", "holiday"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  asRole("admin");
  db.ticket.findMany.mockResolvedValue([{ id: "t1", number: 1, status: "new" }]);
  db.ticket.count.mockResolvedValue(1);
  db.ticket.groupBy.mockResolvedValue([{ status: "new", _count: { _all: 1 } }]);
  db.sLARule.findMany.mockResolvedValue([]);
  db.businessHours.findUnique.mockResolvedValue(null);
  db.holiday.findMany.mockResolvedValue([]);
});

describe("GET /api/tickets", () => {
  it("lists tickets with status counts", async () => {
    const { GET } = await import("@/app/api/tickets/route");
    const res = await GET(createRequest("/api/tickets"), {} as never);
    const body = await parseJsonResponse(res);
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.counts.new).toBe(1);
    expect(body.counts.closed).toBe(0);
  });

  it("status=open means every status except closed", async () => {
    const { GET } = await import("@/app/api/tickets/route");
    await GET(createRequest("/api/tickets?status=open"), {} as never);
    const where = db.ticket.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"status":{"in":["new","ai_suggested","answered","reopened","working"]}');
  });

  it("limits staff to their projects", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    const { GET } = await import("@/app/api/tickets/route");
    await GET(createRequest("/api/tickets"), {} as never);
    const where = db.ticket.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"projectId":{"in":["p1"]}');
  });

  it("assignee=me filters by the logged-in user", async () => {
    const { GET } = await import("@/app/api/tickets/route");
    await GET(createRequest("/api/tickets?assignee=me"), {} as never);
    expect(JSON.stringify(db.ticket.findMany.mock.calls[0][0].where)).toContain('"assigneeId":"u1"');
  });

  it("sla=breached adds the sla where", async () => {
    const { GET } = await import("@/app/api/tickets/route");
    await GET(createRequest("/api/tickets?sla=breached"), {} as never);
    expect(JSON.stringify(db.ticket.findMany.mock.calls[0][0].where)).toContain('"slaPausedAt":null');
  });

  it("returns slaCounts next to counts", async () => {
    db.ticket.count.mockImplementation(async ({ where }: { where?: unknown } = {}) => {
      const s = JSON.stringify(where ?? {});
      if (s.includes("firstReplyWarnAt")) return 2;
      if (s.includes("firstReplyDueAt")) return 3;
      return 1;
    });
    const { GET } = await import("@/app/api/tickets/route");
    const res = await GET(createRequest("/api/tickets"), {} as never);
    const body = await parseJsonResponse(res);
    expect(body.slaCounts).toEqual({ near: 2, breached: 3 });
  });
});

describe("POST /api/tickets", () => {
  it("rejects an empty description", async () => {
    const { POST } = await import("@/app/api/tickets/route");
    const res = await POST(createRequest("/api/tickets", { method: "POST", body: { text: "  " } }), {} as never);
    expect(res.status).toBe(400);
  });

  it("refuses a project the staff member can't see", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    const { POST } = await import("@/app/api/tickets/route");
    const res = await POST(createRequest("/api/tickets", { method: "POST", body: { text: "x", projectId: "p2" } }), {} as never);
    expect(res.status).toBe(403);
  });

  it("creates a ticket", async () => {
    db.conversation.create.mockResolvedValue({ id: "c1" });
    db.message.create.mockResolvedValue({ id: "m1" });
    db.ticketCounter.upsert.mockResolvedValue({ next: 8 });
    db.project.findFirst.mockResolvedValue({ id: "p1" });
    db.ticket.create.mockResolvedValue({ id: "t9", number: 7 });
    const { POST } = await import("@/app/api/tickets/route");
    const res = await POST(createRequest("/api/tickets", { method: "POST", body: { text: "Report kosong" } }), {} as never);
    expect(res.status).toBe(201);
    expect(db.ticket.create.mock.calls[0][0].data.number).toBe(7);
  });

  it("refuses a project that doesn't exist", async () => {
    db.project.findFirst.mockResolvedValue(null);
    const { POST } = await import("@/app/api/tickets/route");
    const res = await POST(createRequest("/api/tickets", { method: "POST", body: { text: "x", projectId: "ghost" } }), {} as never);
    expect(res.status).toBe(400);
    expect((await parseJsonResponse(res)).error).toBe("Project not found");
    expect(db.conversation.create).not.toHaveBeenCalled();
  });

  it("refuses an archived project", async () => {
    db.project.findFirst.mockResolvedValue({ id: "p1", archived: true });
    const { POST } = await import("@/app/api/tickets/route");
    const res = await POST(createRequest("/api/tickets", { method: "POST", body: { text: "x", projectId: "p1" } }), {} as never);
    expect(res.status).toBe(400);
    expect((await parseJsonResponse(res)).error).toBe("Project is archived");
    expect(db.conversation.create).not.toHaveBeenCalled();
  });
});
