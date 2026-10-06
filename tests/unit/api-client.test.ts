import { describe, it, expect } from "vitest";
import { unwrapList, listMeta } from "@/lib/api-client";

describe("unwrapList", () => {
  it("returns data from a paginated response", () => {
    const json = { data: [{ id: 1 }, { id: 2 }], pagination: { page: 1, limit: 20, total: 2, totalPages: 1 } };
    expect(unwrapList(json)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("passes a plain array through", () => {
    expect(unwrapList([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("returns an empty array for anything else", () => {
    expect(unwrapList(null)).toEqual([]);
    expect(unwrapList({ error: "nope" })).toEqual([]);
    expect(unwrapList("text")).toEqual([]);
  });
});

describe("listMeta", () => {
  it("returns pagination when present", () => {
    const meta = { page: 2, limit: 10, total: 25, totalPages: 3 };
    expect(listMeta({ data: [], pagination: meta })).toEqual(meta);
  });

  it("returns null without pagination", () => {
    expect(listMeta([1, 2])).toBeNull();
    expect(listMeta(undefined)).toBeNull();
  });
});
