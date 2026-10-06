import { describe, it, expect } from "vitest";
import { closingOptions } from "@/lib/sla/closing-options";

describe("closingOptions", () => {
  it("lists the usual choices", () => {
    expect(closingOptions(3).map((o) => o.value)).toEqual([0, 1, 2, 3, 5, 7, 14]);
  });

  it("adds a stored value that isn't one of them, in order", () => {
    const opts = closingOptions(4);
    expect(opts.map((o) => o.value)).toEqual([0, 1, 2, 3, 4, 5, 7, 14]);
    expect(opts.find((o) => o.value === 4)?.label).toBe("4 days");
  });
});
