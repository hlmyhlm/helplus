import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { CrossCompanyLinkError } from "@/lib/tenant/links";

const A = "it-2a-a";
const B = "it-2a-b";
let projA: string;
let projB: string;

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({
    data: [
      { id: A, name: "A", slug: A },
      { id: B, name: "B", slug: B },
    ],
  });
  projA = (await runWithCompany(A, () => prisma.project.create({ data: { name: "General", isDefault: true } }))).id;
  projB = (await runWithCompany(B, () => prisma.project.create({ data: { name: "General", isDefault: true } }))).id;
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("tickets core schema", () => {
  it("numbers are unique per company, not globally", async () => {
    const a = await runWithCompany(A, () =>
      prisma.ticket.create({ data: { number: 1, title: "t", description: "", projectId: projA } })
    );
    const b = await runWithCompany(B, () =>
      prisma.ticket.create({ data: { number: 1, title: "t", description: "", projectId: projB } })
    );
    expect([a.number, b.number]).toEqual([1, 1]);
  });

  it("refuses the same number twice in one company", async () => {
    await runWithCompany(B, () =>
      prisma.ticket.create({ data: { number: 10, title: "t", description: "", projectId: projB } })
    );
    await expect(
      runWithCompany(B, () => prisma.ticket.create({ data: { number: 10, title: "t", description: "", projectId: projB } }))
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("a ticket can't use another company's project", async () => {
    await expect(
      runWithCompany(B, () => prisma.ticket.create({ data: { number: 2, title: "t", description: "", projectId: projA } }))
    ).rejects.toThrow(CrossCompanyLinkError);
  });

  it("new tickets start as new", async () => {
    const t = await runWithCompany(A, () =>
      prisma.ticket.create({ data: { number: 3, title: "t", description: "", projectId: projA } })
    );
    expect(t.status).toBe("new");
    expect(t.reopenCount).toBe(0);
  });
});
