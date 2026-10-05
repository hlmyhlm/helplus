import { describe, it, expect } from "vitest";
import { scopeArgs, isTenantModel } from "@/lib/tenant/scope";
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
