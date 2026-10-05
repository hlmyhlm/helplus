import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { MissingCompanyError, runWithCompany } from "@/lib/tenant/context";

const A = "it-fc-a";
const B = "it-fc-b";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({
    data: [
      { id: A, name: "A", slug: A },
      { id: B, name: "B", slug: B },
    ],
  });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("no company in context", () => {
  it("refuses to read", async () => {
    await expect(prisma.customer.findMany()).rejects.toThrow(MissingCompanyError);
  });

  it("refuses to write", async () => {
    await expect(prisma.customer.create({ data: { name: "nobody" } })).rejects.toThrow(MissingCompanyError);
  });

  it("refuses the Company table too", async () => {
    await expect(prisma.company.findMany()).rejects.toThrow(MissingCompanyError);
  });
});

describe("Company through the scoped client", () => {
  it("only shows the current company", async () => {
    const rows = await runWithCompany(A, () => prisma.company.findMany());
    expect(rows.map((c) => c.id)).toEqual([A]);
    expect(await runWithCompany(A, () => prisma.company.findUnique({ where: { slug: B } }))).toBeNull();
    expect(await runWithCompany(A, () => prisma.company.count())).toBe(1);
  });

  it("refuses writes", async () => {
    await expect(
      runWithCompany(A, () => prisma.company.update({ where: { id: A }, data: { name: "x" } }))
    ).rejects.toThrow(/systemPrisma/);
  });
});
