import { describe, it, expect } from "vitest";
import { formatMins } from "@/lib/sla/format";

describe("formatMins", () => {
  it("shows minutes under an hour", () => {
    expect(formatMins(45)).toBe("45m");
  });

  it("shows a bare hour", () => {
    expect(formatMins(60)).toBe("1h");
  });

  it("shows hours with leftover minutes", () => {
    expect(formatMins(150)).toBe("2h 30m");
  });

  it("shows a full day as hours", () => {
    expect(formatMins(1440)).toBe("24h");
  });
});
