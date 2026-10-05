import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { CrossCompanyLinkError, LINKS, guardNestedWrites, linkedIds } from "@/lib/tenant/links";

describe("LINKS", () => {
  it("matches every foreign key in schema.prisma except companyId", () => {
    const schema = readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
    const found: Record<string, Record<string, string>> = {};
    let model = "";
    for (const line of schema.split("\n")) {
      const m = line.match(/^model (\w+)/);
      if (m) model = m[1];
      const rel = line.match(/^\s+\w+\s+(\w+)\??\s+@relation\(fields: \[(\w+)\]/);
      if (rel && rel[2] !== "companyId") {
        (found[model] ??= {})[rel[2]] = rel[1];
      }
    }
    expect(LINKS).toEqual(found);
  });
});

describe("linkedIds", () => {
  it("collects set foreign keys from one row", () => {
    expect(linkedIds("Ticket", { title: "x", conversationId: "c1", departmentId: null })).toEqual([
      { field: "conversationId", target: "Conversation", id: "c1" },
    ]);
  });

  it("collects from many rows and from Prisma's { set } form", () => {
    expect(
      linkedIds("ConversationTag", [{ conversationId: "c1", tagId: "t1" }, { conversationId: { set: "c2" }, tagId: "t1" }])
    ).toEqual([
      { field: "conversationId", target: "Conversation", id: "c1" },
      { field: "tagId", target: "Tag", id: "t1" },
      { field: "conversationId", target: "Conversation", id: "c2" },
    ]);
  });

  it("ignores models without links", () => {
    expect(linkedIds("Customer", { name: "x" })).toEqual([]);
  });
});

describe("guardNestedWrites", () => {
  it("stamps the company on allowed nested creates, single and createMany", () => {
    const { args, nested } = guardNestedWrites(
      "Customer",
      "create",
      { data: { name: "x", notes: { createMany: { data: [{ content: "a", companyId: "other" }] } } } },
      "co"
    );
    expect(args.data).toEqual({ name: "x", notes: { createMany: { data: [{ content: "a", companyId: "co" }] } } });
    expect(nested).toEqual([{ model: "CustomerNote", rows: [{ content: "a", companyId: "co" }] }]);
  });

  it("refuses relation writes in upsert update and in array rows", () => {
    expect(() =>
      guardNestedWrites("Customer", "upsert", { create: { name: "x" }, update: { notes: { deleteMany: {} } } }, "co")
    ).toThrow(CrossCompanyLinkError);
    expect(() =>
      guardNestedWrites("Ticket", "createMany", { data: [{ title: "t", conversation: { connect: { id: "c" } } }] }, "co")
    ).toThrow(CrossCompanyLinkError);
  });

  it("leaves plain scalar writes alone", () => {
    const args = { data: { title: "t", conversationId: "c1" } };
    expect(guardNestedWrites("Ticket", "create", args, "co")).toEqual({ args, nested: [] });
  });
});
