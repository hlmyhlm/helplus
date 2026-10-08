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
  for (const fn of Object.values(db.emailOutbox)) fn.mockReset();
  asRole("admin");
});

describe("GET /api/email-outbox", () => {
  it("asks for emails:manage", async () => {
    db.emailOutbox.findMany.mockResolvedValue([]);
    db.emailOutbox.count.mockResolvedValue(0);
    const { GET } = await import("@/app/api/email-outbox/route");
    await GET(createRequest("/api/email-outbox"), {} as never);
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "emails:manage");
  });

  it("filters by status=failed", async () => {
    db.emailOutbox.findMany.mockResolvedValue([]);
    db.emailOutbox.count.mockResolvedValue(0);
    const { GET } = await import("@/app/api/email-outbox/route");
    await GET(createRequest("/api/email-outbox", { searchParams: { status: "failed" } }), {} as never);
    expect(db.emailOutbox.findMany.mock.calls[0][0].where).toEqual({ status: "failed" });
  });

  it("accepts status=sending", async () => {
    db.emailOutbox.findMany.mockResolvedValue([]);
    db.emailOutbox.count.mockResolvedValue(0);
    const { GET } = await import("@/app/api/email-outbox/route");
    await GET(createRequest("/api/email-outbox", { searchParams: { status: "sending" } }), {} as never);
    expect(db.emailOutbox.findMany.mock.calls[0][0].where).toEqual({ status: "sending" });
  });

  it("status=all skips the filter", async () => {
    db.emailOutbox.findMany.mockResolvedValue([]);
    db.emailOutbox.count.mockResolvedValue(0);
    const { GET } = await import("@/app/api/email-outbox/route");
    const body = await parseJsonResponse(
      await GET(createRequest("/api/email-outbox", { searchParams: { status: "all" } }), {} as never)
    );
    expect(db.emailOutbox.findMany.mock.calls[0][0].where).toEqual({});
    expect(body.data).toEqual([]);
  });

  it("counts stalePending across all rows, regardless of the current filter", async () => {
    db.emailOutbox.findMany.mockResolvedValue([]);
    db.emailOutbox.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    const { GET } = await import("@/app/api/email-outbox/route");
    const body = await parseJsonResponse(
      await GET(createRequest("/api/email-outbox", { searchParams: { status: "failed" } }), {} as never)
    );
    expect(body.stalePending).toBe(2);
    expect(db.emailOutbox.count).toHaveBeenNthCalledWith(2, {
      where: { status: { in: ["pending", "sending"] }, nextAttemptAt: { lt: expect.any(Date) } },
    });
  });
});

describe("POST /api/email-outbox/:id/retry", () => {
  it("resets status, attempts and nextAttemptAt only from pending or failed", async () => {
    db.emailOutbox.updateMany.mockResolvedValue({ count: 1 });
    db.emailOutbox.findUnique.mockResolvedValue({ id: "e1", status: "pending", attempts: 0 });
    const { POST } = await import("@/app/api/email-outbox/[id]/retry/route");
    const res = await POST(createRequest("/api/email-outbox/e1/retry", { method: "POST" }), { params: Promise.resolve({ id: "e1" }) });
    expect(res.status).toBe(200);
    expect(db.emailOutbox.updateMany).toHaveBeenCalledWith({
      where: { id: "e1", status: { in: ["pending", "failed"] } },
      data: expect.objectContaining({ status: "pending", attempts: 0 }),
    });
    expect((await parseJsonResponse(res)).status).toBe("pending");
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "emails:manage");
  });

  it("refuses a row that's already sent", async () => {
    db.emailOutbox.updateMany.mockResolvedValue({ count: 0 });
    db.emailOutbox.findUnique.mockResolvedValue({ id: "e1", status: "sent" });
    const { POST } = await import("@/app/api/email-outbox/[id]/retry/route");
    const res = await POST(createRequest("/api/email-outbox/e1/retry", { method: "POST" }), { params: Promise.resolve({ id: "e1" }) });
    expect(res.status).toBe(409);
  });

  it("refuses a row the worker claimed in the meantime", async () => {
    db.emailOutbox.updateMany.mockResolvedValue({ count: 0 });
    db.emailOutbox.findUnique.mockResolvedValue({ id: "e1", status: "sending" });
    const { POST } = await import("@/app/api/email-outbox/[id]/retry/route");
    const res = await POST(createRequest("/api/email-outbox/e1/retry", { method: "POST" }), { params: Promise.resolve({ id: "e1" }) });
    expect(res.status).toBe(409);
    expect(db.emailOutbox.update).not.toHaveBeenCalled();
  });

  it("404s when the row doesn't exist", async () => {
    db.emailOutbox.updateMany.mockResolvedValue({ count: 0 });
    db.emailOutbox.findUnique.mockResolvedValue(null);
    const { POST } = await import("@/app/api/email-outbox/[id]/retry/route");
    const res = await POST(createRequest("/api/email-outbox/e1/retry", { method: "POST" }), { params: Promise.resolve({ id: "e1" }) });
    expect(res.status).toBe(404);
  });
});
