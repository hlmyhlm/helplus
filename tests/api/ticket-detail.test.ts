import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest } from "../helpers/request";

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
  for (const m of ["ticket", "project", "projectAccess", "message", "internalNote", "admin"]) {
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
  db.ticket.update.mockImplementation(async ({ data }) => ({ ...ticket, ...data }));
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
