import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest } from "../helpers/request";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ctx = { params: Promise.resolve({ id: "c1" }) };
const scoped = { tickets: { some: { projectId: { in: ["p1"] } } } };
const conversation = { id: "c1", channel: "whatsapp", customerName: "Ali", status: "active" };

// the db would drop the row when the project filter doesn't match
const hidden = async ({ where }: { where: Record<string, unknown> }) => (where.tickets ? null : conversation);

beforeEach(() => {
  for (const m of ["conversation", "message", "internalNote", "customer", "projectAccess", "conversationTag"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  vi.mocked(requireAuth).mockResolvedValue({
    userId: "s1",
    role: "staff",
    username: "s",
    name: "Staff",
    authMethod: "cookie",
    companyId: "test-company",
  } as never);
  db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
  db.conversation.findUnique.mockImplementation(hidden);
  db.conversation.findFirst.mockImplementation(hidden);
  db.conversation.findMany.mockResolvedValue([]);
  db.conversation.count.mockResolvedValue(0);
});

describe("staff limited to p1", () => {
  it("only lists conversations with a ticket in p1", async () => {
    const { GET } = await import("@/app/api/conversations/route");
    await GET(createRequest("/api/conversations", { searchParams: { channel: "whatsapp" } }));
    expect(db.conversation.findMany.mock.calls[0][0].where).toMatchObject({ channel: "whatsapp", ...scoped });
    expect(db.conversation.count.mock.calls[0][0].where).toMatchObject(scoped);
  });

  it("gets 404 on a conversation outside p1", async () => {
    const { GET, PUT, DELETE } = await import("@/app/api/conversations/[id]/route");
    expect((await GET(createRequest("/api/conversations/c1"), ctx)).status).toBe(404);
    const put = await PUT(createRequest("/api/conversations/c1", { method: "PUT", body: { status: "closed" } }), ctx);
    expect(put.status).toBe(404);
    expect((await DELETE(createRequest("/api/conversations/c1", { method: "DELETE" }), ctx)).status).toBe(404);
    expect(db.conversation.update).not.toHaveBeenCalled();
    expect(db.conversation.delete).not.toHaveBeenCalled();
  });

  it("can't read or add messages outside p1", async () => {
    const { GET, POST } = await import("@/app/api/conversations/[id]/messages/route");
    expect((await GET(createRequest("/api/conversations/c1/messages"), ctx)).status).toBe(404);
    const post = await POST(
      createRequest("/api/conversations/c1/messages", { method: "POST", body: { content: "hi", role: "agent" } }),
      ctx
    );
    expect(post.status).toBe(404);
    expect(db.message.findMany).not.toHaveBeenCalled();
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it("can't read or add notes outside p1", async () => {
    const { GET, POST } = await import("@/app/api/conversations/[id]/notes/route");
    expect((await GET(createRequest("/api/conversations/c1/notes"), ctx)).status).toBe(404);
    const post = await POST(createRequest("/api/conversations/c1/notes", { method: "POST", body: { content: "x" } }), ctx);
    expect(post.status).toBe(404);
    expect(db.internalNote.findMany).not.toHaveBeenCalled();
    expect(db.internalNote.create).not.toHaveBeenCalled();
  });

  it("only lists a customer's conversations in p1", async () => {
    db.customer.findUnique.mockResolvedValue({ id: "cu1", email: "a@b.c", phone: null, whatsapp: null });
    const { GET } = await import("@/app/api/customers/[id]/conversations/route");
    await GET(createRequest("/api/customers/cu1/conversations"), { params: Promise.resolve({ id: "cu1" }) });
    expect(db.conversation.findMany.mock.calls[0][0].where).toMatchObject(scoped);
    expect(db.conversation.count.mock.calls[0][0].where).toMatchObject(scoped);
  });

  it("an admin's list has no project filter", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      userId: "a1",
      role: "admin",
      username: "a",
      name: "A",
      authMethod: "cookie",
      companyId: "test-company",
    } as never);
    const { GET } = await import("@/app/api/conversations/route");
    await GET(createRequest("/api/conversations"));
    expect(db.conversation.findMany.mock.calls[0][0].where.tickets).toBeUndefined();
  });
});

describe("old messages route", () => {
  it("masks IC numbers for every role", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      userId: "a1",
      role: "admin",
      username: "a",
      name: "A",
      authMethod: "cookie",
      companyId: "test-company",
    } as never);
    db.message.create.mockImplementation(async ({ data }) => ({ id: "m1", ...data }));
    const { POST } = await import("@/app/api/conversations/[id]/messages/route");
    for (const role of ["customer", "agent"]) {
      db.message.create.mockClear();
      const res = await POST(
        createRequest("/api/conversations/c1/messages", { method: "POST", body: { content: "IC 900101-14-5678", role } }),
        ctx
      );
      expect(res.status).toBe(201);
      expect(db.message.create.mock.calls[0][0].data.content).not.toContain("900101");
    }
  });
});
