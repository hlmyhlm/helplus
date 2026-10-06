import { describe, it, expect } from "vitest";
import { slaTimes, slaState, slaWhere } from "@/lib/sla/clock";
import { ALWAYS_OPEN } from "@/lib/sla/calendar";

const created = new Date("2026-10-05T00:00:00Z");
const rule = { id: "r1", firstResponseMins: 100, resolutionMins: 1000 };
const min = (n: number) => new Date(created.getTime() + n * 60_000);

describe("slaTimes", () => {
  it("sets warn at 80% and due at 100%", () => {
    expect(slaTimes(created, 0, rule, ALWAYS_OPEN)).toEqual({
      slaRuleId: "r1",
      firstReplyWarnAt: min(80),
      firstReplyDueAt: min(100),
      resolveWarnAt: min(800),
      resolveDueAt: min(1000),
    });
  });

  it("pushes only the resolution clock by paused time", () => {
    const t = slaTimes(created, 50, rule, ALWAYS_OPEN);
    expect(t.firstReplyDueAt).toEqual(min(100));
    expect(t.resolveDueAt).toEqual(min(1050));
  });

  it("clears everything without a rule", () => {
    expect(slaTimes(created, 0, null, ALWAYS_OPEN)).toEqual({
      slaRuleId: null,
      firstReplyWarnAt: null,
      firstReplyDueAt: null,
      resolveWarnAt: null,
      resolveDueAt: null,
    });
  });
});

const base = {
  status: "new",
  firstReplyAt: null as Date | null,
  closedAt: null as Date | null,
  slaPausedAt: null as Date | null,
  ...slaTimes(created, 0, rule, ALWAYS_OPEN),
};

describe("slaState", () => {
  it("walks from ok to near to breached on the first reply clock", () => {
    expect(slaState(base, min(10))).toBe("ok");
    expect(slaState(base, min(85))).toBe("near");
    expect(slaState(base, min(101))).toBe("breached");
  });

  it("stops the first reply clock once someone replied", () => {
    expect(slaState({ ...base, status: "working", firstReplyAt: min(20) }, min(101))).toBe("ok");
    expect(slaState({ ...base, status: "working", firstReplyAt: min(20) }, min(1001))).toBe("breached");
  });

  it("is paused while answered", () => {
    expect(slaState({ ...base, status: "answered", firstReplyAt: min(20), slaPausedAt: min(30) }, min(2000))).toBe("paused");
  });

  it("is met or missed once closed", () => {
    expect(slaState({ ...base, status: "closed", firstReplyAt: min(20), closedAt: min(500) }, min(3000))).toBe("met");
    expect(slaState({ ...base, status: "closed", firstReplyAt: min(20), closedAt: min(1200) }, min(3000))).toBe("missed");
    expect(slaState({ ...base, status: "closed", firstReplyAt: min(150), closedAt: min(500) }, min(3000))).toBe("missed");
  });

  it("is none without a rule", () => {
    expect(slaState({ ...base, ...slaTimes(created, 0, null, ALWAYS_OPEN) }, min(5000))).toBe("none");
  });
});

describe("slaWhere", () => {
  it("only looks at running tickets", () => {
    const now = min(5);
    expect(JSON.stringify(slaWhere("breached", now))).toContain('"slaPausedAt":null');
    expect(JSON.stringify(slaWhere("near", now))).toContain('"NOT"');
  });
});
