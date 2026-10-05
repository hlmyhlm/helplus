import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { CrossCompanyLinkError } from "@/lib/tenant/links";

const A = "it-links-a";
const B = "it-links-b";
let convA: string;
let tagA: string;

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({
    data: [
      { id: A, name: "A", slug: A },
      { id: B, name: "B", slug: B },
    ],
  });
  convA = (await runWithCompany(A, () => prisma.conversation.create({ data: { channel: "web", customerName: "x", customerContact: "x" } }))).id;
  tagA = (await runWithCompany(A, () => prisma.tag.create({ data: { name: "vip" } }))).id;
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("links across companies", () => {
  it("refuses to create a row linked to another company's row", async () => {
    await expect(
      runWithCompany(B, () => prisma.ticket.create({ data: { title: "t", description: "d", conversationId: convA } }))
    ).rejects.toThrow(CrossCompanyLinkError);
  });

  it("refuses to re-point an own row at another company's row", async () => {
    const t = await runWithCompany(B, () => prisma.ticket.create({ data: { title: "t", description: "d" } }));
    await expect(
      runWithCompany(B, () => prisma.ticket.update({ where: { id: t.id }, data: { conversationId: convA } }))
    ).rejects.toThrow(CrossCompanyLinkError);
  });

  it("refuses createMany with a foreign tag", async () => {
    const convB = await runWithCompany(B, () =>
      prisma.conversation.create({ data: { channel: "web", customerName: "y", customerContact: "y" } })
    );
    await expect(
      runWithCompany(B, () => prisma.conversationTag.createMany({ data: [{ conversationId: convB.id, tagId: tagA }] }))
    ).rejects.toThrow(CrossCompanyLinkError);
  });

  it("allows links inside the same company and empty links", async () => {
    const t = await runWithCompany(A, () =>
      prisma.ticket.create({ data: { title: "t", description: "d", conversationId: convA, departmentId: null } })
    );
    expect(t.conversationId).toBe(convA);
  });

  it("refuses a link to an id that doesn't exist", async () => {
    await expect(
      runWithCompany(A, () => prisma.ticket.create({ data: { title: "t", description: "d", conversationId: "nope" } }))
    ).rejects.toThrow(CrossCompanyLinkError);
  });
});
