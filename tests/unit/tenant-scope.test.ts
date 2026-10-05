import { describe, it, expect } from "vitest";
import { scopeArgs, scopeCompanyArgs, isTenantModel } from "@/lib/tenant/scope";
import { channelKey, tagKey } from "@/lib/tenant/keys";
import { runWithCompany } from "@/lib/tenant/context";

const C = "co-1";

describe("isTenantModel", () => {
  it("treats Company as global and everything else as tenant data", () => {
    expect(isTenantModel("Company")).toBe(false);
    expect(isTenantModel("Ticket")).toBe(true);
    expect(isTenantModel(undefined)).toBe(false);
  });
});

describe("scopeArgs", () => {
  it("adds companyId to unique lookups", () => {
    expect(scopeArgs("Ticket", "findUnique", { where: { id: "t1" } }, C)).toEqual({
      where: { id: "t1", companyId: C },
    });
  });

  it("wraps filters in AND so OR conditions can't escape", () => {
    const out = scopeArgs("Ticket", "findMany", { where: { OR: [{ status: "open" }, { status: "new" }] } }, C);
    expect(out.where).toEqual({ AND: [{ OR: [{ status: "open" }, { status: "new" }] }, { companyId: C }] });
  });

  it("adds a filter when there was none", () => {
    expect(scopeArgs("Ticket", "count", undefined, C)).toEqual({ where: { companyId: C } });
  });

  it("stamps companyId on create and ignores one passed in", () => {
    const out = scopeArgs("Ticket", "create", { data: { title: "x", companyId: "other" } }, C);
    expect(out.data).toEqual({ title: "x", companyId: C });
  });

  it("stamps every row of createMany", () => {
    const out = scopeArgs("Tag", "createMany", { data: [{ name: "a" }, { name: "b", companyId: "x" }] }, C);
    expect(out.data).toEqual([
      { name: "a", companyId: C },
      { name: "b", companyId: C },
    ]);
  });

  it("never lets an update move a row to another company", () => {
    expect(scopeArgs("Ticket", "update", { where: { id: "t1" }, data: { companyId: "other", title: "y" } }, C)).toEqual({
      where: { id: "t1", companyId: C },
      data: { title: "y" },
    });
    expect(scopeArgs("Ticket", "updateMany", { where: {}, data: { companyId: "other" } }, C).data).toEqual({});
  });

  it("scopes upsert lookup, create and update", () => {
    expect(
      scopeArgs("Channel", "upsert", { where: { id: "c1" }, create: { type: "email" }, update: { companyId: "x", status: "ok" } }, C)
    ).toEqual({
      where: { id: "c1", companyId: C },
      create: { type: "email", companyId: C },
      update: { status: "ok" },
    });
  });

  it("scopes deleteMany, aggregate and groupBy", () => {
    for (const op of ["deleteMany", "aggregate", "groupBy", "findFirst"]) {
      expect(scopeArgs("Ticket", op, { where: { status: "open" } }, C).where).toEqual({
        AND: [{ status: "open" }, { companyId: C }],
      });
    }
  });

  it("refuses operations it doesn't know", () => {
    expect(() => scopeArgs("Ticket", "somethingNew", {}, C)).toThrow(/unhandled operation/);
  });
});

describe("compound keys", () => {
  it("builds per-company unique keys", () => {
    runWithCompany(C, () => {
      expect(channelKey("whatsapp")).toEqual({ companyId_type: { companyId: C, type: "whatsapp" } });
      expect(tagKey("vip")).toEqual({ companyId_name: { companyId: C, name: "vip" } });
    });
  });
});

describe("scopeCompanyArgs", () => {
  it("limits Company reads to the current company", () => {
    expect(scopeCompanyArgs("findMany", undefined, C)).toEqual({ where: { id: C } });
    expect(scopeCompanyArgs("count", { where: { slug: "x" } }, C)).toEqual({ where: { AND: [{ slug: "x" }, { id: C }] } });
    expect(scopeCompanyArgs("findUnique", { where: { slug: "x" }, select: { id: true } }, C)).toEqual({
      where: { slug: "x", AND: [{ id: C }] },
      select: { id: true },
    });
    expect(scopeCompanyArgs("findUniqueOrThrow", { where: { id: "y", AND: { name: "n" } } }, C)).toEqual({
      where: { id: "y", AND: [{ name: "n" }, { id: C }] },
    });
  });

  it("refuses Company writes", () => {
    for (const op of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
      expect(() => scopeCompanyArgs(op, { data: {} }, C)).toThrow(/systemPrisma/);
    }
  });
});

describe("createMany with bad data", () => {
  it("throws instead of stamping an empty row", () => {
    expect(() => scopeArgs("Ticket", "createMany", {}, C)).toThrow(/createMany/);
    expect(() => scopeArgs("Ticket", "createManyAndReturn", { data: "x" }, C)).toThrow(/createMany/);
    expect(() => scopeArgs("Ticket", "createMany", { data: [{ title: "a" }, null] }, C)).toThrow(/createMany/);
  });
});
