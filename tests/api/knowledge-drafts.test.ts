import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest, parseJsonResponse } from "../helpers/request";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ctx = { params: Promise.resolve({ id: "d1" }) };

const asRole = (role: string) =>
  vi.mocked(requireAuth).mockResolvedValue({
    userId: "u1",
    role,
    username: "u",
    name: "U",
    authMethod: "cookie",
    companyId: "test-company",
  } as never);

const draft = { id: "d1", title: "Reset password", content: "Q: how\n\nA: like this", status: "draft", isActive: false, projectId: "p1" };

beforeEach(() => {
  for (const m of ["knowledgeEntry", "projectAccess", "category"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  vi.mocked(requireAuth).mockClear();
  asRole("admin");
});

describe("GET /api/knowledge/drafts", () => {
  it("asks for knowledge:read and lists drafts with pagination", async () => {
    db.knowledgeEntry.findMany.mockResolvedValue([draft]);
    db.knowledgeEntry.count.mockResolvedValue(1);

    const { GET } = await import("@/app/api/knowledge/drafts/route");
    const res = await GET(createRequest("/api/knowledge/drafts"), {} as never);
    const body = await parseJsonResponse(res);

    expect(vi.mocked(requireAuth).mock.calls[0][1]).toBe("knowledge:read");
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toMatchObject({ page: 1, total: 1 });
    expect(db.knowledgeEntry.findMany.mock.calls[0][0].where).toMatchObject({ status: "draft" });
  });

  it("limits staff to their projects", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.knowledgeEntry.findMany.mockResolvedValue([]);
    db.knowledgeEntry.count.mockResolvedValue(0);

    const { GET } = await import("@/app/api/knowledge/drafts/route");
    await GET(createRequest("/api/knowledge/drafts"), {} as never);

    const where = db.knowledgeEntry.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("draft");
    expect(JSON.stringify(where)).toContain('"projectId":{"in":["p1"]}');
  });

  it("filters by projectId but never outside the staff scope", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.knowledgeEntry.findMany.mockResolvedValue([]);
    db.knowledgeEntry.count.mockResolvedValue(0);

    const { GET } = await import("@/app/api/knowledge/drafts/route");
    await GET(createRequest("/api/knowledge/drafts", { searchParams: { projectId: "p2" } }), {} as never);

    const where = db.knowledgeEntry.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('"p2"');
    expect(JSON.stringify(where)).toContain('"in":[]');
  });

  it("returns only a count when asked", async () => {
    db.knowledgeEntry.count.mockResolvedValue(4);

    const { GET } = await import("@/app/api/knowledge/drafts/route");
    const res = await GET(createRequest("/api/knowledge/drafts", { searchParams: { count: "1" } }), {} as never);

    expect(await parseJsonResponse(res)).toEqual({ count: 4 });
    expect(db.knowledgeEntry.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/knowledge/drafts/:id", () => {
  it("approves a draft", async () => {
    db.knowledgeEntry.findFirst.mockResolvedValueOnce(draft);
    db.knowledgeEntry.update.mockResolvedValue({ ...draft, status: "approved", isActive: true });

    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await POST(createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "approve" } }), ctx);

    expect(res.status).toBe(200);
    expect(vi.mocked(requireAuth).mock.calls[0][1]).toBe("knowledge:update");
    expect(db.knowledgeEntry.update.mock.calls[0][0]).toMatchObject({
      where: { id: "d1" },
      data: { status: "approved", isActive: true },
    });
  });

  it("404s for a draft outside the staff member's projects", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.knowledgeEntry.findFirst.mockResolvedValue(null);

    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await POST(createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "approve" } }), ctx);

    expect(res.status).toBe(404);
    expect(JSON.stringify(db.knowledgeEntry.findFirst.mock.calls[0][0].where)).toContain('"projectId":{"in":["p1"]}');
    expect(db.knowledgeEntry.update).not.toHaveBeenCalled();
  });

  it("409s when the entry is already approved", async () => {
    db.knowledgeEntry.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "d1", status: "approved" });

    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await POST(createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "approve" } }), ctx);

    expect(res.status).toBe(409);
    expect(db.knowledgeEntry.update).not.toHaveBeenCalled();
  });

  it("rejects by deleting the draft", async () => {
    db.knowledgeEntry.findFirst.mockResolvedValueOnce(draft);
    db.knowledgeEntry.delete.mockResolvedValue(draft);

    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await POST(createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "reject" } }), ctx);

    expect(res.status).toBe(200);
    expect(db.knowledgeEntry.delete).toHaveBeenCalledWith({ where: { id: "d1" } });
  });

  it("reject needs knowledge:delete, so a supervisor can approve but not reject", async () => {
    asRole("supervisor");
    db.knowledgeEntry.findFirst.mockResolvedValue(draft);
    db.knowledgeEntry.update.mockResolvedValue({ ...draft, status: "approved", isActive: true });

    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");
    const rejected = await POST(createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "reject" } }), ctx);
    expect(rejected.status).toBe(403);
    expect(db.knowledgeEntry.delete).not.toHaveBeenCalled();

    const approved = await POST(createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "approve" } }), ctx);
    expect(approved.status).toBe(200);
  });

  it("400s on an unknown action", async () => {
    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await POST(createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "nope" } }), ctx);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/knowledge/drafts/:id", () => {
  it("masks an IC in edited text", async () => {
    db.knowledgeEntry.findFirst.mockResolvedValueOnce(draft);
    db.knowledgeEntry.update.mockImplementation(async ({ data }) => ({ ...draft, ...data }));

    const { PATCH } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await PATCH(
      createRequest("/api/knowledge/drafts/d1", { method: "PATCH", body: { title: "For 900101-14-5678", content: "Q: my ic 900101145678\n\nA: ok" } }),
      ctx
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(requireAuth).mock.calls[0][1]).toBe("knowledge:update");
    const data = db.knowledgeEntry.update.mock.calls[0][0].data;
    expect(data.title).toBe("For [IC HIDDEN]");
    expect(data.content).toBe("Q: my ic [IC HIDDEN]\n\nA: ok");
    expect(data.status).toBeUndefined();
    expect(data.isActive).toBeUndefined();
  });

  it("refuses an empty title", async () => {
    db.knowledgeEntry.findFirst.mockResolvedValueOnce(draft);

    const { PATCH } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await PATCH(createRequest("/api/knowledge/drafts/d1", { method: "PATCH", body: { title: "  " } }), ctx);

    expect(res.status).toBe(400);
    expect(db.knowledgeEntry.update).not.toHaveBeenCalled();
  });
});

describe("GET /api/knowledge/entries", () => {
  it("lists approved entries only", async () => {
    db.knowledgeEntry.findMany.mockResolvedValue([]);
    db.knowledgeEntry.count.mockResolvedValue(0);

    const { GET } = await import("@/app/api/knowledge/entries/route");
    await GET(createRequest("/api/knowledge/entries", { searchParams: { categoryId: "c1" } }), {} as never);

    expect(db.knowledgeEntry.findMany.mock.calls[0][0].where).toEqual({ status: "approved", categoryId: "c1" });
    expect(db.knowledgeEntry.count.mock.calls[0][0].where).toEqual({ status: "approved", categoryId: "c1" });
  });
});

describe("PUT /api/knowledge/entries/:id", () => {
  it("won't touch a draft, so it can't be switched on behind approval", async () => {
    db.knowledgeEntry.findFirst.mockResolvedValue(null);

    const { PUT } = await import("@/app/api/knowledge/entries/[id]/route");
    const res = await PUT(createRequest("/api/knowledge/entries/d1", { method: "PUT", body: { isActive: true } }), ctx);

    expect(res.status).toBe(404);
    expect(db.knowledgeEntry.findFirst.mock.calls[0][0].where).toEqual({ id: "d1", status: "approved" });
    expect(db.knowledgeEntry.update).not.toHaveBeenCalled();
  });
});
