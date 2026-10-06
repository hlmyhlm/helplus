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
  for (const m of ["conversation", "ticket", "message", "projectAccess"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  asRole("admin");
  db.conversation.count.mockResolvedValue(0);
  db.ticket.count.mockResolvedValue(0);
  db.message.count.mockResolvedValue(0);
  db.conversation.groupBy.mockResolvedValue([]);
});

describe("GET /api/stats", () => {
  it("an admin sees company-wide totals, unscoped", async () => {
    const { GET } = await import("@/app/api/stats/route");
    await GET(createRequest("/api/stats"), {} as never);
    expect(db.conversation.count.mock.calls[0][0].where).toEqual({});
    expect(db.message.count.mock.calls[0][0].where).toEqual({ conversation: {} });
  });

  it("staff limited to p1 get conversation and message totals scoped to their projects", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);

    const { GET } = await import("@/app/api/stats/route");
    await GET(createRequest("/api/stats"), {} as never);

    const convoWhere = db.conversation.count.mock.calls[0][0].where;
    expect(JSON.stringify(convoWhere)).toContain('"projectId":{"in":["p1"]}');
    const msgWhere = db.message.count.mock.calls[0][0].where;
    expect(JSON.stringify(msgWhere.conversation)).toContain('"projectId":{"in":["p1"]}');
    const ticketWhere = db.ticket.count.mock.calls[0][0].where;
    expect(ticketWhere).toEqual({ projectId: { in: ["p1"] } });
  });

  it("returns the computed fields", async () => {
    db.conversation.count.mockResolvedValueOnce(10).mockResolvedValueOnce(4).mockResolvedValueOnce(6);
    db.ticket.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);
    db.message.count.mockResolvedValue(20);

    const { GET } = await import("@/app/api/stats/route");
    const body = await parseJsonResponse(await GET(createRequest("/api/stats"), {} as never));
    expect(body).toMatchObject({
      totalConversations: 10,
      activeConversations: 4,
      resolvedConversations: 6,
      totalTickets: 5,
      openTickets: 2,
      totalMessages: 20,
      resolutionRate: 60,
    });
  });
});
