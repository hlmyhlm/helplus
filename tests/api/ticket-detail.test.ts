import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest } from "../helpers/request";
import { notifyTicket } from "@/lib/notify/notify";

vi.mock("@/lib/notify/notify", () => ({ notifyTicket: vi.fn(), companyName: vi.fn() }));

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ctx = { params: Promise.resolve({ id: "t1" }) };
const ticket = {
  id: "t1",
  number: 5,
  status: "working",
  projectId: "p1",
  firstReplyAt: null,
  reopenCount: 0,
  conversationId: "c1",
};

beforeEach(() => {
  for (const m of ["ticket", "project", "projectAccess", "message", "internalNote", "admin", "sLARule", "businessHours", "holiday", "attachment"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  vi.mocked(requireAuth).mockResolvedValue({
    userId: "u1",
    role: "admin",
    username: "u",
    name: "Aisyah",
    authMethod: "cookie",
    companyId: "test-company",
  } as never);
  db.ticket.findUnique.mockResolvedValue(ticket);
  db.ticket.findMany.mockResolvedValue([]);
  vi.mocked(notifyTicket).mockReset();
  db.ticket.update.mockImplementation(async ({ data }) => ({ ...ticket, ...data }));
  db.sLARule.findMany.mockResolvedValue([]);
  db.businessHours.findUnique.mockResolvedValue(null);
  db.holiday.findMany.mockResolvedValue([]);
  (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction.mockReset();
  (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db));
});

describe("PATCH /api/tickets/:id", () => {
  it("moves through the allowed steps and stamps times", async () => {
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const res = await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { status: "answered" } }), ctx);
    expect(res.status).toBe(200);
    const data = db.ticket.update.mock.calls[0][0].data;
    expect(data.status).toBe("answered");
    expect(data.firstReplyAt).toBeInstanceOf(Date);
  });

  it("refuses a jump that skips a step", async () => {
    db.ticket.findUnique.mockResolvedValue({ ...ticket, status: "closed" });
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const res = await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { status: "answered" } }), ctx);
    expect(res.status).toBe(409);
  });

  it("rejects a projectId that doesn't exist, even for a role that sees every project", async () => {
    db.project.findFirst.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const res = await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { projectId: "ghost" } }), ctx);
    expect(res.status).toBe(400);
    expect(db.ticket.update).not.toHaveBeenCalled();
  });

  it("moves the other tickets on the same conversation along with it", async () => {
    db.project.findFirst.mockResolvedValue({ id: "p2", archived: false });
    db.ticket.updateMany.mockResolvedValue({ count: 1 });
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const res = await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { projectId: "p2" } }), ctx);
    expect(res.status).toBe(200);
    expect(db.ticket.update.mock.calls[0][0].data.projectId).toBe("p2");
    expect(db.ticket.updateMany).toHaveBeenCalledWith({
      where: { conversationId: "c1", id: { not: "t1" }, status: "closed" },
      data: { projectId: "p2" },
    });
    // the ticket save and the sibling move run as one unit
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("re-picks the rule for open tickets on the same conversation", async () => {
    db.project.findFirst.mockResolvedValue({ id: "p2", archived: false });
    db.ticket.updateMany.mockResolvedValue({ count: 1 });
    db.sLARule.findMany.mockResolvedValue([
      { id: "r9", projectId: "p2", priority: "all", category: "all", source: "all", firstResponseMins: 10, resolutionMins: 100, isActive: true },
    ]);
    const sibling = { ...ticket, id: "t2", priority: "medium", category: "", source: "web", createdAt: new Date(), slaPausedMins: 0 };
    db.ticket.findUnique.mockResolvedValue({ ...sibling, id: "t1" });
    db.ticket.findMany.mockResolvedValue([sibling]);
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { projectId: "p2" } }), ctx);
    const siblingSave = db.ticket.update.mock.calls.find((c) => c[0].where.id === "t2");
    expect(siblingSave?.[0].data).toMatchObject({ projectId: "p2", slaRuleId: "r9" });
    expect(db.ticket.findMany.mock.calls[0][0].where).toEqual({ conversationId: "c1", id: { not: "t1" }, status: { not: "closed" } });
  });

  it("saves without a transaction when the project doesn't move", async () => {
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { status: "answered" } }), ctx);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.sLARule.findMany).toHaveBeenCalledTimes(1);
  });

  it("emails about a reopen only once the move commits", async () => {
    db.ticket.findUnique.mockResolvedValue({ ...ticket, status: "closed", closedAt: new Date() });
    db.project.findFirst.mockResolvedValue({ id: "p2", archived: false });
    db.ticket.updateMany.mockResolvedValue({ count: 1 });
    const tx = (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction;
    tx.mockImplementationOnce(async (fn: (t: unknown) => Promise<unknown>) => {
      await fn(db);
      throw new Error("rolled back");
    });
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const failed = await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { status: "reopened", projectId: "p2" } }), ctx);
    expect(failed.status).toBe(500);
    expect(notifyTicket).not.toHaveBeenCalled();

    const ok = await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { status: "reopened", projectId: "p2" } }), ctx);
    expect(ok.status).toBe(200);
    expect(notifyTicket).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyTicket).mock.calls[0][0]).toBe("reopened");
    expect(vi.mocked(notifyTicket).mock.calls[0][2]).toEqual({ actorId: "u1" });
  });

  it("refuses to move a ticket into an archived project", async () => {
    db.project.findFirst.mockResolvedValue({ id: "p2", archived: true });
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const res = await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { projectId: "p2" } }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Project is archived");
    expect(db.ticket.update).not.toHaveBeenCalled();
  });

  it("won't hand a ticket to staff who can't see its project", async () => {
    db.admin.findUnique.mockResolvedValue({ role: "staff" });
    db.projectAccess.findFirst.mockResolvedValue(null);
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const res = await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { assigneeId: "s9" } }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("That person can't see this project");
    expect(db.ticket.update).not.toHaveBeenCalled();
  });

  it("hands a ticket to staff who can see its project", async () => {
    db.admin.findUnique.mockResolvedValue({ role: "staff" });
    db.projectAccess.findFirst.mockResolvedValue({ id: "pa1" });
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const res = await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { assigneeId: "s9" } }), ctx);
    expect(res.status).toBe(200);
    expect(db.projectAccess.findFirst.mock.calls[0][0].where).toEqual({ adminId: "s9", projectId: "p1" });
  });

  it("checks the new project when assigning and moving together", async () => {
    db.admin.findUnique.mockResolvedValue({ role: "staff" });
    db.projectAccess.findFirst.mockResolvedValue({ id: "pa1" });
    db.project.findFirst.mockResolvedValue({ id: "p2", archived: false });
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { assigneeId: "s9", projectId: "p2" } }), ctx);
    expect(db.projectAccess.findFirst.mock.calls[0][0].where).toEqual({ adminId: "s9", projectId: "p2" });
  });

  it("won't move a ticket to a project its current assignee can't see", async () => {
    db.ticket.findUnique.mockResolvedValue({ ...ticket, assigneeId: "s9" });
    db.admin.findUnique.mockResolvedValue({ role: "staff" });
    db.projectAccess.findFirst.mockResolvedValue(null);
    db.project.findFirst.mockResolvedValue({ id: "p2", archived: false });
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const res = await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { projectId: "p2" } }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("That person can't see this project");
    expect(db.projectAccess.findFirst.mock.calls[0][0].where).toEqual({ adminId: "s9", projectId: "p2" });
    expect(db.ticket.update).not.toHaveBeenCalled();
  });

  it("hides tickets in projects the staff member can't see", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      userId: "u2",
      role: "staff",
      username: "s",
      name: "S",
      authMethod: "cookie",
      companyId: "test-company",
    } as never);
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "other" }]);
    const { GET } = await import("@/app/api/tickets/[id]/route");
    const res = await GET(createRequest("/api/tickets/t1"), ctx);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/tickets/:id", () => {
  it("removes attachment files before deleting the ticket row", async () => {
    db.attachment.findMany.mockResolvedValue([]);
    db.ticket.delete.mockResolvedValue({});
    const { DELETE } = await import("@/app/api/tickets/[id]/route");
    const res = await DELETE(createRequest("/api/tickets/t1", { method: "DELETE" }), ctx);
    expect(res.status).toBe(200);
    expect(db.attachment.findMany).toHaveBeenCalledWith({ where: { ticketId: "t1" }, select: { id: true, companyId: true } });
    expect(db.attachment.findMany.mock.invocationCallOrder[0]).toBeLessThan(db.ticket.delete.mock.invocationCallOrder[0]);
  });
});

describe("POST /api/tickets/:id/messages", () => {
  it("saves the staff reply and marks the ticket answered", async () => {
    db.message.create.mockResolvedValue({ id: "m1", role: "agent", content: "Sila cuba lagi" });
    const { POST } = await import("@/app/api/tickets/[id]/messages/route");
    const res = await POST(
      createRequest("/api/tickets/t1/messages", { method: "POST", body: { content: "Sila cuba lagi" } }),
      ctx
    );
    expect(res.status).toBe(201);
    expect(db.message.create.mock.calls[0][0].data).toMatchObject({ conversationId: "c1", role: "agent" });
    expect(db.ticket.update.mock.calls[0][0].data.status).toBe("answered");
  });

  it("can reply without changing the step", async () => {
    db.message.create.mockResolvedValue({ id: "m1" });
    const { POST } = await import("@/app/api/tickets/[id]/messages/route");
    await POST(
      createRequest("/api/tickets/t1/messages", { method: "POST", body: { content: "noted", markAnswered: false } }),
      ctx
    );
    const data = db.ticket.update.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
    expect(data.firstReplyAt).toBeInstanceOf(Date);
  });

  it("won't reply on a closed ticket", async () => {
    db.ticket.findUnique.mockResolvedValue({ ...ticket, status: "closed" });
    const { POST } = await import("@/app/api/tickets/[id]/messages/route");
    const res = await POST(createRequest("/api/tickets/t1/messages", { method: "POST", body: { content: "x" } }), ctx);
    expect(res.status).toBe(409);
  });
});

describe("notes", () => {
  it("stores the author's name", async () => {
    db.internalNote.create.mockResolvedValue({ id: "n1" });
    const { POST } = await import("@/app/api/tickets/[id]/notes/route");
    await POST(createRequest("/api/tickets/t1/notes", { method: "POST", body: { content: "called her" } }), ctx);
    expect(db.internalNote.create.mock.calls[0][0].data).toEqual({ conversationId: "c1", content: "called her", authorName: "Aisyah" });
  });
});

describe("tickets outside the staff member's projects", () => {
  beforeEach(() => {
    vi.mocked(requireAuth).mockResolvedValue({
      userId: "u2",
      role: "staff",
      username: "s",
      name: "S",
      authMethod: "cookie",
      companyId: "test-company",
    } as never);
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "other" }]);
  });

  it("DELETE gets 404", async () => {
    // mocked auth skips the role check
    const { DELETE } = await import("@/app/api/tickets/[id]/route");
    expect((await DELETE(createRequest("/api/tickets/t1", { method: "DELETE" }), ctx)).status).toBe(404);
    expect(db.ticket.delete).not.toHaveBeenCalled();
  });

  it("notes GET and POST get 404", async () => {
    const { GET, POST } = await import("@/app/api/tickets/[id]/notes/route");
    expect((await GET(createRequest("/api/tickets/t1/notes"), ctx)).status).toBe(404);
    const post = await POST(createRequest("/api/tickets/t1/notes", { method: "POST", body: { content: "x" } }), ctx);
    expect(post.status).toBe(404);
    expect(db.internalNote.create).not.toHaveBeenCalled();
  });

  it("messages POST gets 404", async () => {
    const { POST } = await import("@/app/api/tickets/[id]/messages/route");
    const res = await POST(createRequest("/api/tickets/t1/messages", { method: "POST", body: { content: "x" } }), ctx);
    expect(res.status).toBe(404);
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("PATCH to a project id they don't have gets 403, even if it doesn't exist", async () => {
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const res = await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { projectId: "ghost" } }), ctx);
    expect(res.status).toBe(403);
    expect(db.ticket.update).not.toHaveBeenCalled();
  });
});
