import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { CrossCompanyLinkError, LINKS, RELATIONS, guardNestedWrites, linkedIds } from "@/lib/tenant/links";

type Map2 = Record<string, Record<string, string>>;

// reads foreign keys (LINKS) and relation fields (RELATIONS) out of a prisma schema.
// both skip the company relation. throws on a composite key so LINKS can't silently miss it.
function parseSchema(schema: string) {
  const models = new Set([...schema.matchAll(/^model (\w+)/gm)].map((m) => m[1]));
  const links: Map2 = {};
  const relations: Map2 = {};
  let model = "";
  for (const line of schema.split("\n")) {
    const m = line.match(/^model (\w+)/);
    if (m) model = m[1];
    const field = line.match(/^\s+(\w+)\s+(\w+)/);
    if (!field || model === "Company") continue;
    const [, name, type] = field;
    if (models.has(type) && type !== "Company") (relations[model] ??= {})[name] = type;
    if (!line.includes("@relation(")) continue;
    const fk = line.match(/fields:\s*\[([^\]]*)\]/);
    if (!fk) continue;
    if (fk[1].includes(",")) throw new Error(`composite FK, extend LINKS: ${model}.${name}`);
    const key = fk[1].trim();
    if (key !== "companyId") (links[model] ??= {})[key] = type;
  }
  return { links, relations };
}

function count(map: Map2) {
  return Object.values(map).reduce((n, fields) => n + Object.keys(fields).length, 0);
}

describe("schema parser", () => {
  const sample = `model A {
  id    String @id
  b     B      @relation("named", fields: [bId], references: [id])
  bId   String
  c     C?     @relation(references: [id], fields: [cId])
  cId   String?
  ds    D[]
  company Company @relation(fields: [companyId], references: [id])
}
model B {
  id String @id
}
model C {
  id String @id
}
model D {
  id String @id
}
model Company {
  id String @id
  as A[]
}`;

  it("handles named and references-first relations and list relations", () => {
    expect(parseSchema(sample)).toEqual({
      links: { A: { bId: "B", cId: "C" } },
      relations: { A: { b: "B", c: "C", ds: "D" } },
    });
  });

  it("fails on a composite key", () => {
    const composite = sample.replace("fields: [bId]", "fields: [bId, cId]");
    expect(() => parseSchema(composite)).toThrow("composite FK, extend LINKS");
  });
});

describe("LINKS and RELATIONS", () => {
  const schema = readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
  const parsed = parseSchema(schema);

  it("parsed every @relation with fields", () => {
    const fkLines = schema
      .split("\n")
      .filter((l) => l.includes("@relation(") && /fields:/.test(l) && !/fields:\s*\[\s*companyId\s*\]/.test(l));
    expect(fkLines.length).toBeGreaterThan(0);
    expect(count(parsed.links)).toBe(fkLines.length);
  });

  it("LINKS matches every foreign key in schema.prisma except companyId", () => {
    expect(LINKS).toEqual(parsed.links);
  });

  it("RELATIONS matches every relation field except company", () => {
    expect(RELATIONS).toEqual(parsed.relations);
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
