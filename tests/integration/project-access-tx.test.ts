import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";

// the access save runs in a transaction, it must stay in one company

const A = "it-access-tx-a";
const B = "it-access-tx-b";

let projectA: string;
let projectB: string;
let adminA: string;
let adminB: string;

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({
    data: [
      { id: A, name: "Access Tx A", slug: A },
      { id: B, name: "Access Tx B", slug: B },
    ],
  });

  const pa = await systemPrisma.project.create({ data: { companyId: A, name: "Project A" } });
  const pb = await systemPrisma.project.create({ data: { companyId: B, name: "Project B" } });
  projectA = pa.id;
  projectB = pb.id;

  const aa = await systemPrisma.admin.create({
    data: { companyId: A, username: "it-access-tx-staff-a", password: "x", role: "staff" },
  });
  const ab = await systemPrisma.admin.create({
    data: { companyId: B, username: "it-access-tx-staff-b", password: "x", role: "staff" },
  });
  adminA = aa.id;
  adminB = ab.id;

  // company B already has an access row before company A's write runs
  await systemPrisma.projectAccess.create({ data: { companyId: B, projectId: projectB, adminId: adminB } });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("project access replace, inside a transaction", () => {
  it("stays scoped to the acting company", async () => {
    await runWithCompany(A, () =>
      prisma.$transaction(async (tx) => {
        await tx.projectAccess.deleteMany({ where: { projectId: projectA } });
        await tx.projectAccess.createMany({ data: [{ projectId: projectA, adminId: adminA }] });
      })
    );

    // B's row, created before A's write, is untouched
    const bRows = await systemPrisma.projectAccess.findMany({ where: { projectId: projectB } });
    expect(bRows).toHaveLength(1);
    expect(bRows[0].adminId).toBe(adminB);
    expect(bRows[0].companyId).toBe(B);

    // A's new row carries A's companyId, stamped by the scoped client inside tx
    const aRows = await systemPrisma.projectAccess.findMany({ where: { projectId: projectA } });
    expect(aRows).toHaveLength(1);
    expect(aRows[0].adminId).toBe(adminA);
    expect(aRows[0].companyId).toBe(A);
  });
});
