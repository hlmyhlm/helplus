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
