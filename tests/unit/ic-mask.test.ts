import { describe, it, expect } from "vitest";
import { maskIC, IC_PLACEHOLDER } from "@/lib/privacy/ic-mask";

describe("maskIC", () => {
  it.each([
    ["900101-14-5678", "dashes"],
    ["900101145678", "no separators"],
    ["900101 14 5678", "spaces"],
    ["900101-14 5678", "mixed"],
  ])("hides %s (%s)", (ic) => {
    const out = maskIC(`IC saya ${ic} tak boleh semak`);
    expect(out.text).toBe(`IC saya ${IC_PLACEHOLDER} tak boleh semak`);
    expect(out.count).toBe(1);
  });

  it("hides an IC glued to a label", () => {
    expect(maskIC("IC:900101145678.").text).toBe(`IC:${IC_PLACEHOLDER}.`);
  });

  it("hides every IC in the text", () => {
    const out = maskIC("900101-14-5678 dan 851231-10-1234");
    expect(out.text).toBe(`${IC_PLACEHOLDER} dan ${IC_PLACEHOLDER}`);
    expect(out.count).toBe(2);
  });

  it("works across lines", () => {
    expect(maskIC("nama: Ali\nic: 900101145678").count).toBe(1);
  });

  it.each([
    ["012-345 6789", "mobile number"],
    ["0123456789", "10 digits"],
    ["90010114567", "11 digits"],
    ["9001011456789", "13 digits"],
    ["RM 1,234.56", "money"],
    ["2026-10-04", "date"],
  ])("leaves %s alone (%s)", (text) => {
    expect(maskIC(text)).toEqual({ text, count: 0 });
  });

  it("handles empty text", () => {
    expect(maskIC("")).toEqual({ text: "", count: 0 });
  });
});
