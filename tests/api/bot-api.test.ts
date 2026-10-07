import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { hasPermission, type Permission } from "@/lib/rbac";
import { createRequest, parseJsonResponse } from "../helpers/request";

vi.mock("@/lib/bot/intake", () => ({ placeReply: vi.fn() }));
import { placeReply } from "@/lib/bot/intake";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const asRole = (role: string) =>
  vi.mocked(requireAuth).mockImplementation(async (_req, permission) =>
    permission && !hasPermission(role, permission as Permission)
      ? NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 })
      : ({ userId: "u1", role, username: "u", name: "U", authMethod: "cookie", companyId: "test-company" } as never)
  );

beforeEach(() => {
  for (const m of ["waChat", "waInbound", "chatSender", "teamMember", "ticket", "project", "projectAccess"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  vi.mocked(placeReply).mockReset();
  asRole("admin");
});

describe("GET /api/bot/chats", () => {
  it("lists chats newest first with counts, not-linked ones included", async () => {
    db.waChat.findMany.mockResolvedValue([
      { id: "c2", name: "Acme group", isGroup: true, projectId: "p1", project: { name: "Acme" }, lastMessageAt: new Date("2026-10-07T10:00:00Z") },
      { id: "c1", name: "New group", isGroup: true, projectId: null, project: null, lastMessageAt: new Date("2026-10-06T10:00:00Z") },
    ]);
    db.waInbound.groupBy.mockResolvedValue([
      { chatId: "c2", state: "pending", _count: { _all: 3 } },
      { chatId: "c2", state: "pick", _count: { _all: 1 } },
    ]);

    const { GET } = await import("@/app/api/bot/chats/route");
    const res = await GET(createRequest("/api/bot/chats"), {} as never);
    const body = await parseJsonResponse(res);

    expect(res.status).toBe(200);
    expect(vi.mocked(requireAuth).mock.calls[0][1]).toBe("channels:read");
    expect(db.waChat.findMany.mock.calls[0][0].orderBy).toEqual({ lastMessageAt: { sort: "desc", nulls: "last" } });
    expect(body.data).toEqual([
      { id: "c2", name: "Acme group", isGroup: true, projectId: "p1", projectName: "Acme", lastMessageAt: "2026-10-07T10:00:00.000Z", pending: 3, picks: 1 },
      { id: "c1", name: "New group", isGroup: true, projectId: null, projectName: null, lastMessageAt: "2026-10-06T10:00:00.000Z", pending: 0, picks: 0 },
    ]);
  });

  it("viewer gets 403", async () => {
    asRole("viewer");
    const { GET } = await import("@/app/api/bot/chats/route");
    const res = await GET(createRequest("/api/bot/chats"), {} as never);
    expect(res.status).toBe(403);
    expect(db.waChat.findMany).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/bot/chats/:id", () => {
  const patch = (projectId: unknown) =>
    createRequest("/api/bot/chats/c1", { method: "PATCH", body: { projectId } });

  it("links a group to a project", async () => {
    db.waChat.findFirst.mockResolvedValue({ id: "c1", projectId: null });
    db.project.findFirst.mockResolvedValue({ archived: false });
    db.waChat.update.mockResolvedValue({ id: "c1", projectId: "p1" });

    const { PATCH } = await import("@/app/api/bot/chats/[id]/route");
    const res = await PATCH(patch("p1"), ctx("c1"));

    expect(res.status).toBe(200);
    expect(db.waChat.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { projectId: "p1" } });
    expect((await parseJsonResponse(res)).projectId).toBe("p1");
    expect(db.waInbound.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an archived project with projectProblem's message", async () => {
    db.waChat.findFirst.mockResolvedValue({ id: "c1", projectId: null });
    db.project.findFirst.mockResolvedValue({ archived: true });

    const { PATCH } = await import("@/app/api/bot/chats/[id]/route");
    const res = await PATCH(patch("p9"), ctx("c1"));

    expect(res.status).toBe(400);
    expect((await parseJsonResponse(res)).error).toBe("Project is archived");
    expect(db.waChat.update).not.toHaveBeenCalled();
  });

  it("unlinking ignores the chat's pending rows", async () => {
    db.waChat.findFirst.mockResolvedValue({ id: "c1", projectId: "p1" });
    db.waChat.update.mockResolvedValue({ id: "c1", projectId: null });
    db.waInbound.updateMany.mockResolvedValue({ count: 2 });

    const { PATCH } = await import("@/app/api/bot/chats/[id]/route");
    const res = await PATCH(patch(null), ctx("c1"));

    expect(res.status).toBe(200);
    expect(db.waChat.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { projectId: null } });
    const call = db.waInbound.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ chatId: "c1", state: "pending" });
    expect(call.data.state).toBe("ignored");
  });

  it("400s when projectId is missing", async () => {
    const { PATCH } = await import("@/app/api/bot/chats/[id]/route");
    const res = await PATCH(createRequest("/api/bot/chats/c1", { method: "PATCH", body: {} }), ctx("c1"));
    expect(res.status).toBe(400);
  });

  it("404s on a chat that isn't there", async () => {
    db.waChat.findFirst.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/bot/chats/[id]/route");
    const res = await PATCH(patch("p1"), ctx("c1"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/bot/senders", () => {
  it("lists senders of the last 30 days and marks staff", async () => {
    db.waChat.findFirst.mockResolvedValue({ id: "c1" });
    db.waInbound.groupBy.mockResolvedValue([
      { senderId: "60111@c.us", senderName: "Client Ann", _max: { at: new Date("2026-10-07T09:00:00Z") } },
      { senderId: "60122@c.us", senderName: "Siti", _max: { at: new Date("2026-10-07T10:00:00Z") } },
      { senderId: "60133@c.us", senderName: "Ali", _max: { at: new Date("2026-10-06T10:00:00Z") } },
    ]);
    db.teamMember.findMany.mockResolvedValue([{ phone: "0122" }]);
    db.chatSender.findMany.mockResolvedValue([{ name: "Ali", isStaff: true }]);

    const { GET } = await import("@/app/api/bot/senders/route");
    const res = await GET(createRequest("/api/bot/senders", { searchParams: { chatId: "c1" } }), {} as never);
    const body = await parseJsonResponse(res);

    expect(res.status).toBe(200);
    const where = db.waInbound.groupBy.mock.calls[0][0].where;
    expect(where.chatId).toBe("c1");
    expect(Date.now() - where.at.gte.getTime()).toBeGreaterThanOrEqual(30 * 86_400_000 - 1000);
    expect(body.data).toEqual([
      { name: "Siti", staff: true, fromTeam: true, lastAt: "2026-10-07T10:00:00.000Z" },
      { name: "Client Ann", staff: false, fromTeam: false, lastAt: "2026-10-07T09:00:00.000Z" },
      { name: "Ali", staff: true, fromTeam: false, lastAt: "2026-10-06T10:00:00.000Z" },
    ]);
  });

  it("400s without a chatId", async () => {
    const { GET } = await import("@/app/api/bot/senders/route");
    const res = await GET(createRequest("/api/bot/senders"), {} as never);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/bot/senders", () => {
  it("upserts the sender with the IC hidden", async () => {
    db.chatSender.upsert.mockResolvedValue({});

    const { PATCH } = await import("@/app/api/bot/senders/route");
    const res = await PATCH(
      createRequest("/api/bot/senders", { method: "PATCH", body: { name: "Ali 900101-14-5678", staff: true } }),
      {} as never
    );

    expect(res.status).toBe(200);
    expect(db.chatSender.upsert).toHaveBeenCalledWith({
      where: { companyId_name: { companyId: "test-company", name: "Ali [IC HIDDEN]" } },
      create: { name: "Ali [IC HIDDEN]", isStaff: true },
      update: { isStaff: true },
    });
    expect(await parseJsonResponse(res)).toEqual({ name: "Ali [IC HIDDEN]", staff: true });
  });

  it("400s on a bad body", async () => {
    const { PATCH } = await import("@/app/api/bot/senders/route");
    const res = await PATCH(
      createRequest("/api/bot/senders", { method: "PATCH", body: { name: "Ali", staff: "yes" } }),
      {} as never
    );
    expect(res.status).toBe(400);
    expect(db.chatSender.upsert).not.toHaveBeenCalled();
  });
});

describe("GET /api/bot/picks", () => {
  it("lists replies waiting with the chat's open tickets as options", async () => {
    db.waInbound.findMany.mockResolvedValue([
      { id: "w1", chatId: "c1", chat: { name: "Acme group" }, senderName: "Siti", text: "done, try again", at: new Date("2026-10-07T10:00:00Z") },
    ]);
    db.ticket.findMany.mockResolvedValue([{ id: "t1", number: 12, title: "Login broken", status: "working" }]);

    const { GET } = await import("@/app/api/bot/picks/route");
    const res = await GET(createRequest("/api/bot/picks"), {} as never);
    const body = await parseJsonResponse(res);

    expect(res.status).toBe(200);
    expect(db.waInbound.findMany.mock.calls[0][0].where.state).toBe("pick");
    const t = db.ticket.findMany.mock.calls[0][0];
    expect(t.take).toBe(10);
    expect(t.orderBy).toEqual({ updatedAt: "desc" });
    expect(JSON.stringify(t.where)).toContain('"equals":"c1"');
    expect(body.data).toEqual([
      {
        id: "w1",
        chatName: "Acme group",
        senderName: "Siti",
        text: "done, try again",
        at: "2026-10-07T10:00:00.000Z",
        options: [{ ticketId: "t1", number: 12, title: "Login broken", status: "working" }],
      },
    ]);
  });
});

describe("POST /api/bot/picks/:id", () => {
  const post = (ticketId: unknown) =>
    createRequest("/api/bot/picks/w1", { method: "POST", body: { ticketId } });

  it("places the reply", async () => {
    vi.mocked(placeReply).mockResolvedValue("placed");
    const { POST } = await import("@/app/api/bot/picks/[id]/route");
    const res = await POST(post("t1"), ctx("w1"));
    expect(res.status).toBe(200);
    expect(placeReply).toHaveBeenCalledWith("w1", "t1", "u1");
  });

  it("ignores it when ticketId is null", async () => {
    vi.mocked(placeReply).mockResolvedValue("ignored");
    const { POST } = await import("@/app/api/bot/picks/[id]/route");
    const res = await POST(post(null), ctx("w1"));
    expect(res.status).toBe(200);
    expect(placeReply).toHaveBeenCalledWith("w1", null, "u1");
  });

  it("409s when someone already placed it", async () => {
    vi.mocked(placeReply).mockResolvedValue("gone");
    const { POST } = await import("@/app/api/bot/picks/[id]/route");
    const res = await POST(post("t1"), ctx("w1"));
    expect(res.status).toBe(409);
    expect((await parseJsonResponse(res)).error).toBe("Someone already placed this reply");
  });

  it("staff without the rights gets 403", async () => {
    asRole("staff");
    const { POST } = await import("@/app/api/bot/picks/[id]/route");
    const res = await POST(post("t1"), ctx("w1"));
    expect(res.status).toBe(403);
    expect(placeReply).not.toHaveBeenCalled();
  });

  it("checks tickets:update inside the handler too", async () => {
    // a role that passes channels:read but lacks tickets:update
    vi.mocked(requireAuth).mockResolvedValue({ userId: "u1", role: "nobody", username: "u", name: "U", authMethod: "cookie", companyId: "test-company" } as never);
    const { POST } = await import("@/app/api/bot/picks/[id]/route");
    const res = await POST(post("t1"), ctx("w1"));
    expect(res.status).toBe(403);
    expect(placeReply).not.toHaveBeenCalled();
  });

  it("400s when ticketId is missing", async () => {
    const { POST } = await import("@/app/api/bot/picks/[id]/route");
    const res = await POST(createRequest("/api/bot/picks/w1", { method: "POST", body: {} }), ctx("w1"));
    expect(res.status).toBe(400);
  });
});
