import { describe, it, expect } from "vitest";
import { runWithCompany, currentCompanyId, maybeCompanyId, MissingCompanyError } from "@/lib/tenant/context";

describe("company context", () => {
  it("is empty outside runWithCompany", () => {
    expect(maybeCompanyId()).toBeUndefined();
    expect(() => currentCompanyId()).toThrow(MissingCompanyError);
  });

  it("holds the company inside runWithCompany, across awaits", async () => {
    const seen = await runWithCompany("co-1", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentCompanyId();
    });
    expect(seen).toBe("co-1");
  });

  it("keeps concurrent companies apart", async () => {
    const run = (id: string) =>
      runWithCompany(id, async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        return currentCompanyId();
      });
    expect(await Promise.all([run("a"), run("b"), run("c")])).toEqual(["a", "b", "c"]);
  });

  it("refuses an empty company id", () => {
    expect(() => runWithCompany("", () => 1)).toThrow(MissingCompanyError);
  });
});
