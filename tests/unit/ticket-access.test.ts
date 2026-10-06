import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { allowedProjectIds, projectWhere } from "@/lib/tickets/access";

const access = (prisma as unknown as { projectAccess: { findMany: ReturnType<typeof vi.fn> } }).projectAccess;

beforeEach(() => access.findMany.mockReset());

describe("allowedProjectIds", () => {
  it.each(["owner", "admin", "supervisor"])("%s sees every project", async (role) => {
    expect(await allowedProjectIds({ role, userId: "u1" })).toBeNull();
    expect(access.findMany).not.toHaveBeenCalled();
  });

  it.each(["staff", "viewer"])("%s sees only listed projects", async (role) => {
    access.findMany.mockResolvedValue([{ projectId: "p1" }, { projectId: "p2" }]);
    expect(await allowedProjectIds({ role, userId: "u1" })).toEqual(["p1", "p2"]);
    expect(access.findMany).toHaveBeenCalledWith({ where: { adminId: "u1" }, select: { projectId: true } });
  });

  it("anyone else sees nothing", async () => {
    expect(await allowedProjectIds({ role: "client", userId: "u1" })).toEqual([]);
  });
});

describe("projectWhere", () => {
  it("adds no filter for null", () => {
    expect(projectWhere(null)).toEqual({});
  });

  it("filters by the listed projects", () => {
    expect(projectWhere(["p1"])).toEqual({ projectId: { in: ["p1"] } });
  });
});

describe("conversationWhere", () => {
  it("adds no filter for null", async () => {
    const { conversationWhere } = await import("@/lib/tickets/access");
    expect(conversationWhere(null)).toEqual({});
  });

  it("needs a ticket in one of the listed projects", async () => {
    const { conversationWhere } = await import("@/lib/tickets/access");
    expect(conversationWhere(["p1"])).toEqual({ tickets: { some: { projectId: { in: ["p1"] } } } });
  });
});
