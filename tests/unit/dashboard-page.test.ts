import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

beforeEach(() => {
  vi.mocked(redirect).mockClear();
});

describe("dashboard page", () => {
  it("sends a client back to login, they have no dashboard yet", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "c1",
      username: "client",
      name: "Client",
      role: "client",
      companyId: "co-a",
    });
    const { default: DashboardPage } = await import("@/app/(dashboard)/page");
    await expect(DashboardPage()).rejects.toThrow("redirect:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("only counts and lists what a limited staff member can see", async () => {
    const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "s1",
      username: "staff",
      name: "Staff",
      role: "staff",
      companyId: "co-a",
    });
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.conversation.count.mockResolvedValue(0);
    db.ticket.count.mockResolvedValue(0);
    db.message.count.mockResolvedValue(0);
    db.conversation.findMany.mockResolvedValue([]);
    const { default: DashboardPage } = await import("@/app/(dashboard)/page");
    await DashboardPage();

    const convScope = { tickets: { some: { projectId: { in: ["p1"] } } } };
    expect(db.conversation.findMany.mock.calls[0][0].where).toMatchObject(convScope);
    for (const [args] of db.conversation.count.mock.calls) expect(args.where).toMatchObject(convScope);
    for (const [args] of db.ticket.count.mock.calls) expect(args.where).toMatchObject({ projectId: { in: ["p1"] } });
    for (const [args] of db.message.count.mock.calls) expect(args.where).toMatchObject({ conversation: convScope });
  });
});
