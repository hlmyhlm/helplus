import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { CrossCompanyLinkError } from "@/lib/tenant/links";

const A = "it-2a-a";
const B = "it-2a-b";

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

describe("tickets core schema", () => {
  it("numbers are unique per company, not globally", async () => {
    const make = (company: string) =>
      runWithCompany(company, async () => {
        const p = await prisma.project.create({ data: { name: "General", isDefault: true } });
        return prisma.ticket.create({ data: { number: 1, title: "t", description: "", projectId: p.id } });
      });
    const a = await make(A);
    const b = await make(B);
    expect([a.number, b.number]).toEqual([1, 1]);
  });

  it("a ticket can't use another company's project", async () => {
    const pA = await runWithCompany(A, () => prisma.project.findFirstOrThrow({ where: { isDefault: true } }));
    await expect(
      runWithCompany(B, () => prisma.ticket.create({ data: { number: 2, title: "t", description: "", projectId: pA.id } }))
    ).rejects.toThrow(CrossCompanyLinkError);
  });

  it("new tickets start as new", async () => {
    const t = await runWithCompany(A, async () => {
      const p = await prisma.project.findFirstOrThrow({ where: { isDefault: true } });
      return prisma.ticket.create({ data: { number: 3, title: "t", description: "", projectId: p.id } });
    });
    expect(t.status).toBe("new");
    expect(t.reopenCount).toBe(0);
  });
});
