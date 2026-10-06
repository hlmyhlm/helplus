import { describe, it, expect, vi } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";

describe("prisma mock", () => {
  it("exposes systemPrisma as the same mock client", () => {
    expect(systemPrisma).toBeDefined();
    expect(systemPrisma).toBe(prisma);
    expect(vi.isMockFunction(systemPrisma.company.findMany)).toBe(true);
  });
});
