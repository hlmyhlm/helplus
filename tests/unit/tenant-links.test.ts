import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { LINKS, linkedIds } from "@/lib/tenant/links";

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
