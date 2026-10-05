import { describe, it, expect, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { MissingCompanyError } from "@/lib/tenant/context";

afterAll(async () => {
  await systemPrisma.$disconnect();
});

describe("no company in context", () => {
  it("refuses to read", async () => {
    await expect(prisma.customer.findMany()).rejects.toThrow(MissingCompanyError);
  });

  it("refuses to write", async () => {
    await expect(prisma.customer.create({ data: { name: "nobody" } })).rejects.toThrow(MissingCompanyError);
  });

  it("still allows the global Company table through the scoped client", async () => {
    await expect(prisma.company.findMany()).resolves.toBeInstanceOf(Array);
  });
});
