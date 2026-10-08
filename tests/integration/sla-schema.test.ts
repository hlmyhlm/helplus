import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { CrossCompanyLinkError } from "@/lib/tenant/links";

const A = "it-2b-schema-a";
const B = "it-2b-schema-b";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({ data: [{ id: A, name: "A", slug: A }, { id: B, name: "B", slug: B }] });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("2b schema", () => {
  it("one holiday per date per company", async () => {
    await runWithCompany(A, () => prisma.holiday.create({ data: { date: "2026-12-25", name: "Christmas" } }));
    await runWithCompany(B, () => prisma.holiday.create({ data: { date: "2026-12-25" } }));
    await expect(
      runWithCompany(A, () => prisma.holiday.create({ data: { date: "2026-12-25" } }))
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("an sla rule can't point at another company's project", async () => {
    const pA = await runWithCompany(A, () => prisma.project.create({ data: { name: "Alpha" } }));
    await expect(
      runWithCompany(B, () =>
        prisma.sLARule.create({ data: { name: "x", projectId: pA.id, firstResponseMins: 60, resolutionMins: 480 } })
      )
    ).rejects.toThrow(CrossCompanyLinkError);
  });

  it("new settings default to closing after 3 days", async () => {
    const s = await runWithCompany(A, () => prisma.settings.create({ data: {} }));
    expect(s.autoCloseDays).toBe(3);
  });
});
