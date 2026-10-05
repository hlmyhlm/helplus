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

describe("nested writes", () => {
  it("refuses to connect another company's note to a customer", async () => {
    const custA = await runWithCompany(A, () =>
      prisma.customer.create({ data: { name: "a", notes: { create: { content: "secret", authorName: "x" } } }, include: { notes: true } })
    );
    const custB = await runWithCompany(B, () => prisma.customer.create({ data: { name: "b" } }));
    await expect(
      runWithCompany(B, () =>
        prisma.customer.update({ where: { id: custB.id }, data: { notes: { connect: [{ id: custA.notes[0].id }] } } })
      )
    ).rejects.toThrow(CrossCompanyLinkError);
    const note = await systemPrisma.customerNote.findUnique({ where: { id: custA.notes[0].id } });
    expect(note?.customerId).toBe(custA.id);
  });

  it("stamps the current company on a nested note, whatever the caller sends", async () => {
    const cust = await runWithCompany(B, () =>
      prisma.customer.create({
        data: { name: "c", notes: { create: [{ content: "n", authorName: "x", companyId: A }] } },
        include: { notes: true },
      })
    );
    expect(cust.notes[0].companyId).toBe(B);
  });

  it("refuses a nested create on a relation that isn't allowed", async () => {
    await expect(
      runWithCompany(B, () =>
        prisma.conversation.create({
          data: { channel: "web", customerName: "z", customerContact: "z", messages: { create: { role: "user", content: "hi" } } },
        })
      )
    ).rejects.toThrow(CrossCompanyLinkError);
  });
});
