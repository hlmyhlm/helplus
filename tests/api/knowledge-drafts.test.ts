import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest, parseJsonResponse } from "../helpers/request";
import { fixtures } from "../helpers/fixtures";

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

const draft = {
  id: "d1",
  title: "Reset password",
  content: "Q: how\n\nA: like this",
  status: "draft",
  isActive: false,
  projectId: "p1",
};

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
    await GET(
      createRequest("/api/knowledge/drafts", { searchParams: { projectId: "p2" } }),
      {} as never
    );

    const where = db.knowledgeEntry.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('"p2"');
    expect(JSON.stringify(where)).toContain('"in":[]');
  });

  it("returns only a count when asked", async () => {
    db.knowledgeEntry.count.mockResolvedValue(4);

    const { GET } = await import("@/app/api/knowledge/drafts/route");
    const res = await GET(
      createRequest("/api/knowledge/drafts", { searchParams: { count: "1" } }),
      {} as never
    );

    expect(await parseJsonResponse(res)).toEqual({ count: 4 });
    expect(db.knowledgeEntry.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/knowledge/drafts/:id", () => {
  it("approves with a write that only matches a draft", async () => {
    db.knowledgeEntry.updateMany.mockResolvedValue({ count: 1 });

    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await POST(
      createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "approve" } }),
      ctx
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(requireAuth).mock.calls[0][1]).toBe("knowledge:update");
    expect(db.knowledgeEntry.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "d1", status: "draft" },
      data: { status: "approved", isActive: true },
    });
    expect(db.knowledgeEntry.update).not.toHaveBeenCalled();
  });

  it("scopes the write to the staff member's projects and 404s outside them", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.knowledgeEntry.updateMany.mockResolvedValue({ count: 0 });
    db.knowledgeEntry.findFirst.mockResolvedValue(null);

    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await POST(
      createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "approve" } }),
      ctx
    );

    expect(res.status).toBe(404);
    expect(db.knowledgeEntry.updateMany.mock.calls[0][0].where).toEqual({
      id: "d1",
      status: "draft",
      projectId: { in: ["p1"] },
    });
    expect(JSON.stringify(db.knowledgeEntry.findFirst.mock.calls[0][0].where)).toContain(
      '"projectId":{"in":["p1"]}'
    );
  });

  it("409s when someone approved it first", async () => {
    // the draft flips to approved before our write lands
    db.knowledgeEntry.updateMany.mockResolvedValue({ count: 0 });
    db.knowledgeEntry.findFirst.mockResolvedValue({ id: "d1", status: "approved" });

    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await POST(
      createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "approve" } }),
      ctx
    );

    expect(res.status).toBe(409);
  });

  it("rejects with a delete that only matches a draft", async () => {
    db.knowledgeEntry.deleteMany.mockResolvedValue({ count: 1 });

    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await POST(
      createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "reject" } }),
      ctx
    );

    expect(res.status).toBe(200);
    expect(db.knowledgeEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: "d1", status: "draft" },
    });
    expect(db.knowledgeEntry.delete).not.toHaveBeenCalled();
  });

  it("won't delete an entry approved in the meantime", async () => {
    db.knowledgeEntry.deleteMany.mockResolvedValue({ count: 0 });
    db.knowledgeEntry.findFirst.mockResolvedValue({ id: "d1", status: "approved" });

    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await POST(
      createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "reject" } }),
      ctx
    );

    expect(res.status).toBe(409);
  });

  it("reject needs knowledge:delete, so a supervisor can approve but not reject", async () => {
    asRole("supervisor");
    db.knowledgeEntry.updateMany.mockResolvedValue({ count: 1 });

    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");
    const rejected = await POST(
      createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "reject" } }),
      ctx
    );
    expect(rejected.status).toBe(403);
    expect(db.knowledgeEntry.deleteMany).not.toHaveBeenCalled();

    const approved = await POST(
      createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "approve" } }),
      ctx
    );
    expect(approved.status).toBe(200);
  });

  it("400s on an unknown action", async () => {
    const { POST } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await POST(
      createRequest("/api/knowledge/drafts/d1", { method: "POST", body: { action: "nope" } }),
      ctx
    );
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/knowledge/drafts/:id", () => {
  it("masks an IC in edited text and only writes to a draft", async () => {
    db.knowledgeEntry.updateMany.mockResolvedValue({ count: 1 });
    db.knowledgeEntry.findFirst.mockResolvedValue({ ...draft, title: "For [IC HIDDEN]" });

    const { PATCH } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await PATCH(
      createRequest("/api/knowledge/drafts/d1", {
        method: "PATCH",
        body: { title: "For 900101-14-5678", content: "Q: my ic 900101145678\n\nA: ok" },
      }),
      ctx
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(requireAuth).mock.calls[0][1]).toBe("knowledge:update");
    const call = db.knowledgeEntry.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "d1", status: "draft" });
    expect(call.data.title).toBe("For [IC HIDDEN]");
    expect(call.data.content).toBe("Q: my ic [IC HIDDEN]\n\nA: ok");
    expect(call.data.status).toBeUndefined();
    expect(call.data.isActive).toBeUndefined();
    expect((await parseJsonResponse(res)).title).toBe("For [IC HIDDEN]");
  });

  it("404s when the draft is gone by the time it's read back", async () => {
    db.knowledgeEntry.updateMany.mockResolvedValue({ count: 1 });
    db.knowledgeEntry.findFirst.mockResolvedValue(null);

    const { PATCH } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await PATCH(createRequest("/api/knowledge/drafts/d1", { method: "PATCH", body: { title: "New" } }), ctx);

    expect(res.status).toBe(404);
  });

  it("409s when the draft was approved before the edit landed", async () => {
    db.knowledgeEntry.updateMany.mockResolvedValue({ count: 0 });
    db.knowledgeEntry.findFirst.mockResolvedValue({ id: "d1", status: "approved" });

    const { PATCH } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await PATCH(
      createRequest("/api/knowledge/drafts/d1", { method: "PATCH", body: { title: "New" } }),
      ctx
    );

    expect(res.status).toBe(409);
  });

  it.each([
    ["an empty title", { title: "  " }],
    ["a title over 500", { title: "x".repeat(501) }],
    ["empty content", { content: "   " }],
    ["content over 100000", { content: "x".repeat(100001) }],
  ])("refuses %s", async (_name, body) => {
    const { PATCH } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await PATCH(
      createRequest("/api/knowledge/drafts/d1", { method: "PATCH", body }),
      ctx
    );

    expect(res.status).toBe(400);
    expect(db.knowledgeEntry.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a category that doesn't exist", async () => {
    db.category.findFirst.mockResolvedValue(null);

    const { PATCH } = await import("@/app/api/knowledge/drafts/[id]/route");
    const res = await PATCH(
      createRequest("/api/knowledge/drafts/d1", { method: "PATCH", body: { categoryId: "nope" } }),
      ctx
    );

    expect(res.status).toBe(400);
    expect(db.knowledgeEntry.updateMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/knowledge/entries", () => {
  it("lists approved entries only", async () => {
    db.knowledgeEntry.findMany.mockResolvedValue([]);
    db.knowledgeEntry.count.mockResolvedValue(0);

    const { GET } = await import("@/app/api/knowledge/entries/route");
    await GET(
      createRequest("/api/knowledge/entries", { searchParams: { categoryId: "c1" } }),
      {} as never
    );

    expect(db.knowledgeEntry.findMany.mock.calls[0][0].where).toEqual({
      status: "approved",
      categoryId: "c1",
    });
    expect(db.knowledgeEntry.count.mock.calls[0][0].where).toEqual({
      status: "approved",
      categoryId: "c1",
    });
  });
});

describe("PUT /api/knowledge/entries/:id", () => {
  it("won't touch a draft, so it can't be switched on behind approval", async () => {
    db.knowledgeEntry.findFirst.mockResolvedValue(null);

    const { PUT } = await import("@/app/api/knowledge/entries/[id]/route");
    const res = await PUT(
      createRequest("/api/knowledge/entries/d1", { method: "PUT", body: { isActive: true } }),
      ctx
    );

    expect(res.status).toBe(404);
    expect(db.knowledgeEntry.findFirst.mock.calls[0][0].where).toEqual({
      id: "d1",
      status: "approved",
    });
    expect(db.knowledgeEntry.update).not.toHaveBeenCalled();
  });
});

describe("AI knowledge reads", () => {
  it("semantic search only reads approved, active entries", async () => {
    db.knowledgeEntry.findMany.mockResolvedValue([]);
    const { searchKnowledgeBase } = await import("@/lib/ai/semantic-search");
    await searchKnowledgeBase("hello");
    expect(db.knowledgeEntry.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      status: "approved",
    });
  });

  it("the knowledge test page only reads approved, active entries", async () => {
    db.settings.upsert.mockResolvedValue({ ...fixtures.settings });
    db.knowledgeEntry.findMany.mockResolvedValue([]);
    const { POST } = await import("@/app/api/knowledge/test/route");
    await POST(
      createRequest("/api/knowledge/test", { method: "POST", body: { question: "hi" } }),
      {} as never
    );
    expect(db.knowledgeEntry.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      status: "approved",
    });
  });
});

describe("knowledge export", () => {
  it("has a Status column", async () => {
    db.knowledgeEntry.findMany.mockResolvedValue([
      {
        id: "d1",
        title: "T",
        content: "C",
        priority: 0,
        isActive: false,
        status: "draft",
        category: { name: "Imported" },
      },
    ]);
    const { GET } = await import("@/app/api/export/route");
    const res = await GET(
      createRequest("/api/export", { searchParams: { type: "knowledge", format: "csv" } }),
      {} as never
    );
    const [head, row] = (await res.text()).split("\n");
    expect(head.split(",")).toContain("Status");
    expect(row.split(",")).toContain("draft");
  });
});
