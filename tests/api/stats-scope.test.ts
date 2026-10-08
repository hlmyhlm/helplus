import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest } from "../helpers/request";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ticketScope = { projectId: { in: ["p1"] } };

beforeEach(() => {
  for (const m of ["conversation", "message", "ticket", "category", "teamMember", "projectAccess"]) {
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
  db.conversation.count.mockResolvedValue(0);
  db.conversation.groupBy.mockResolvedValue([]);
  db.conversation.findMany.mockResolvedValue([]);
  db.ticket.count.mockResolvedValue(0);
  db.ticket.groupBy.mockResolvedValue([]);
  db.message.count.mockResolvedValue(0);
  db.message.findMany.mockResolvedValue([]);
  db.category.findMany.mockResolvedValue([]);
  db.teamMember.findMany.mockResolvedValue([]);
});

describe("ticket figures for staff limited to p1", () => {
  it("/api/stats counts only p1 tickets", async () => {
    const { GET } = await import("@/app/api/stats/route");
    expect((await GET(createRequest("/api/stats"))).status).toBe(200);
    expect(db.ticket.count).toHaveBeenCalledTimes(2);
    for (const [args] of db.ticket.count.mock.calls) expect(args.where).toMatchObject(ticketScope);
  });

  it("/api/analytics groups only p1 tickets", async () => {
    const { GET } = await import("@/app/api/analytics/route");
    expect((await GET(createRequest("/api/analytics"))).status).toBe(200);
    expect(db.ticket.groupBy).toHaveBeenCalledTimes(2);
    for (const [args] of db.ticket.groupBy.mock.calls) expect(args.where).toMatchObject(ticketScope);
    expect(db.teamMember.findMany.mock.calls[0][0].select.tickets.where).toMatchObject(ticketScope);
  });
});

describe("analytics top categories", () => {
  it("counts approved entries only and keeps the top 8 by that count", async () => {
    db.category.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({ name: `c${i}`, _count: { entries: i } }))
    );
    const { GET } = await import("@/app/api/analytics/route");
    const body = await (await GET(createRequest("/api/analytics"))).json();

    const args = db.category.findMany.mock.calls[0][0];
    expect(args.select._count).toEqual({ select: { entries: { where: { status: "approved" } } } });
    expect(args.take).toBeUndefined();
    expect(body.topCategories.map((c: { category: string }) => c.category)).toEqual(
      ["c9", "c8", "c7", "c6", "c5", "c4", "c3", "c2"]
    );
  });
});
