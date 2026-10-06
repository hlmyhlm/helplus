import { describe, it, expect } from "vitest";
import { slaLabel, closesOn } from "@/components/tickets/sla-badge";

describe("slaLabel", () => {
  it("only shows the states staff act on", () => {
    expect(slaLabel("near")?.text).toBe("Due soon");
    expect(slaLabel("breached")?.text).toBe("Overdue");
    expect(slaLabel("paused")?.text).toBe("Waiting on client");
    expect(slaLabel("ok")).toBeNull();
    expect(slaLabel("none")).toBeNull();
  });
});

describe("closesOn", () => {
  it("adds the days to the answer time", () => {
    expect(closesOn("2026-10-05T00:00:00Z", 3)).toEqual(new Date("2026-10-08T00:00:00Z"));
  });
  it("waits a full day after the warning", () => {
    expect(closesOn("2026-10-05T00:00:00Z", 3, "2026-10-10T06:00:00Z")).toEqual(new Date("2026-10-11T06:00:00Z"));
    expect(closesOn("2026-10-05T00:00:00Z", 3, "2026-10-06T00:00:00Z")).toEqual(new Date("2026-10-08T00:00:00Z"));
    expect(closesOn("2026-10-05T00:00:00Z", 3, null)).toEqual(new Date("2026-10-08T00:00:00Z"));
  });
  it("is null when auto-close is off or the ticket isn't answered", () => {
    expect(closesOn("2026-10-05T00:00:00Z", 0)).toBeNull();
    expect(closesOn(null, 3)).toBeNull();
  });
});
