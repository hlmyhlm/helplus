import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { channelKey } from "@/lib/tenant/keys";

const A = "it-company-a";
const B = "it-company-b";

const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);
const asB = <T>(fn: () => Promise<T>) => runWithCompany(B, fn);

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B, "it-temp"] } } });
  await systemPrisma.company.createMany({
    data: [
      { id: A, name: "Company A", slug: A },
      { id: B, name: "Company B", slug: B },
    ],
  });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("tenant isolation", () => {
  it("stamps new rows with the current company", async () => {
    const c = await asA(() => prisma.customer.create({ data: { name: "Ali" } }));
    expect(c.companyId).toBe(A);
  });

  it("does not list another company's rows", async () => {
    await asA(() => prisma.customer.create({ data: { name: "only-in-a" } }));
    const seen = await asB(() => prisma.customer.findMany({ where: { name: "only-in-a" } }));
    expect(seen).toEqual([]);
  });

  it("does not find another company's row by id", async () => {
    const c = await asA(() => prisma.customer.create({ data: { name: "by-id" } }));
    expect(await asB(() => prisma.customer.findUnique({ where: { id: c.id } }))).toBeNull();
  });

  it("cannot update or delete another company's row", async () => {
    const c = await asA(() => prisma.customer.create({ data: { name: "locked" } }));
    await expect(asB(() => prisma.customer.update({ where: { id: c.id }, data: { name: "hacked" } }))).rejects.toThrow();
    await expect(asB(() => prisma.customer.delete({ where: { id: c.id } }))).rejects.toThrow();
    const still = await asA(() => prisma.customer.findUnique({ where: { id: c.id } }));
    expect(still?.name).toBe("locked");
  });

  it("bulk writes don't cross companies", async () => {
    await asA(() => prisma.customer.create({ data: { name: "bulk" } }));
    const updated = await asB(() => prisma.customer.updateMany({ where: { name: "bulk" }, data: { name: "x" } }));
    const deleted = await asB(() => prisma.customer.deleteMany({ where: { name: "bulk" } }));
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);
  });

  it("an OR filter can't reach another company", async () => {
    await asA(() => prisma.customer.create({ data: { name: "or-test" } }));
    const seen = await asB(() =>
      prisma.customer.findMany({ where: { OR: [{ name: "or-test" }, { email: "nobody" }] } })
    );
    expect(seen).toEqual([]);
  });

  it("can't move a row into another company", async () => {
    const c = await asA(() => prisma.customer.create({ data: { name: "mover" } }));
    await asA(() => prisma.customer.update({ where: { id: c.id }, data: { companyId: B } as never }));
    const raw = await systemPrisma.customer.findUnique({ where: { id: c.id } });
    expect(raw?.companyId).toBe(A);
  });

  it("counts only the current company", async () => {
    const before = await asB(() => prisma.customer.count());
    await asA(() => prisma.customer.create({ data: { name: "count-me" } }));
    expect(await asB(() => prisma.customer.count())).toBe(before);
  });

  it("allows the same channel type in two companies", async () => {
    const a = await asA(() => prisma.channel.upsert({ where: channelKey("whatsapp"), update: {}, create: { type: "whatsapp" } }));
    const b = await asB(() => prisma.channel.upsert({ where: channelKey("whatsapp"), update: {}, create: { type: "whatsapp" } }));
    expect(a.id).not.toBe(b.id);
    expect([a.companyId, b.companyId]).toEqual([A, B]);
  });

  it("deleting a company removes its data", async () => {
    await systemPrisma.company.create({ data: { id: "it-temp", name: "Temp", slug: "it-temp" } });
    await runWithCompany("it-temp", () => prisma.customer.create({ data: { name: "temp-row" } }));
    await systemPrisma.company.delete({ where: { id: "it-temp" } });
    expect(await systemPrisma.customer.count({ where: { companyId: "it-temp" } })).toBe(0);
  });
});
