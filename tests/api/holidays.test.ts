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
  for (const fn of Object.values(db.holiday)) fn.mockReset();
  asRole("admin");
});

describe("GET /api/holidays", () => {
  it("asks for business-hours:read and orders by date", async () => {
    db.holiday.findMany.mockResolvedValue([{ id: "h1", date: "2026-12-25", name: "Christmas" }]);
    const { GET } = await import("@/app/api/holidays/route");
    const body = await parseJsonResponse(await GET(createRequest("/api/holidays"), {} as never));
    expect(body.data).toHaveLength(1);
    expect(db.holiday.findMany).toHaveBeenCalledWith({ orderBy: { date: "asc" } });
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "business-hours:read");
  });
});

describe("POST /api/holidays", () => {
  it("asks for business-hours:update", async () => {
    db.holiday.create.mockResolvedValue({ id: "h1", date: "2026-12-25", name: "Christmas" });
    const { POST } = await import("@/app/api/holidays/route");
    await POST(createRequest("/api/holidays", { method: "POST", body: { date: "2026-12-25", name: "Christmas" } }), {} as never);
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "business-hours:update");
  });

  it("rejects a bad date format", async () => {
    const { POST } = await import("@/app/api/holidays/route");
    const res = await POST(createRequest("/api/holidays", { method: "POST", body: { date: "25-12-2026" } }), {} as never);
    expect(res.status).toBe(400);
  });

  it("creates a valid holiday", async () => {
    db.holiday.create.mockResolvedValue({ id: "h1", date: "2026-12-25", name: "Christmas" });
    const { POST } = await import("@/app/api/holidays/route");
    const res = await POST(createRequest("/api/holidays", { method: "POST", body: { date: "2026-12-25", name: "Christmas" } }), {} as never);
    expect(res.status).toBe(201);
    expect(db.holiday.create).toHaveBeenCalledWith({ data: { date: "2026-12-25", name: "Christmas" } });
  });

  it("a duplicate date is a 409", async () => {
    db.holiday.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const { POST } = await import("@/app/api/holidays/route");
    const res = await POST(createRequest("/api/holidays", { method: "POST", body: { date: "2026-12-25" } }), {} as never);
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/holidays/:id", () => {
  it("404s when the holiday doesn't exist", async () => {
    db.holiday.findUnique.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/holidays/[id]/route");
    const res = await DELETE(createRequest("/api/holidays/h1", { method: "DELETE" }), { params: Promise.resolve({ id: "h1" }) });
    expect(res.status).toBe(404);
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "business-hours:update");
  });

  it("deletes an existing holiday", async () => {
    db.holiday.findUnique.mockResolvedValue({ id: "h1" });
    const { DELETE } = await import("@/app/api/holidays/[id]/route");
    const res = await DELETE(createRequest("/api/holidays/h1", { method: "DELETE" }), { params: Promise.resolve({ id: "h1" }) });
    expect(res.status).toBe(200);
    expect(db.holiday.delete).toHaveBeenCalledWith({ where: { id: "h1" } });
  });
});
