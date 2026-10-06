import { describe, it, expect } from "vitest";
import { statusChange, InvalidTransitionError, isTicketStatus, OPEN_STATUSES } from "@/lib/tickets/status";

const now = new Date("2026-10-06T10:00:00Z");
const base = { status: "new", firstReplyAt: null, reopenCount: 0 };

describe("statusChange", () => {
  it("answering sets answeredAt and the first reply time", () => {
    expect(statusChange(base, "answered", now)).toEqual({ status: "answered", answeredAt: now, firstReplyAt: now });
  });

  it("keeps an earlier first reply time", () => {
    const earlier = new Date("2026-10-05T10:00:00Z");
    const out = statusChange({ ...base, status: "working", firstReplyAt: earlier }, "answered", now);
    expect(out.firstReplyAt).toBeUndefined();
  });

  it("closing sets closedAt", () => {
    expect(statusChange({ ...base, status: "answered" }, "closed", now)).toEqual({ status: "closed", closedAt: now });
  });

  it("reopening counts and clears closedAt", () => {
    expect(statusChange({ ...base, status: "closed", reopenCount: 1 }, "reopened", now)).toEqual({
      status: "reopened",
      reopenCount: 2,
      closedAt: null,
    });
  });

  it("refuses jumps that skip a step", () => {
    expect(() => statusChange({ ...base, status: "closed" }, "answered", now)).toThrow(InvalidTransitionError);
    expect(() => statusChange(base, "reopened", now)).toThrow(InvalidTransitionError);
  });

  it("does nothing when the status doesn't change", () => {
    expect(statusChange(base, "new", now)).toEqual({});
  });

  it("treats an unknown old status as new", () => {
    expect(statusChange({ ...base, status: "open" }, "working", now)).toEqual({ status: "working" });
  });
});

describe("status helpers", () => {
  it("knows the open statuses", () => {
    expect(OPEN_STATUSES).not.toContain("closed");
    expect(isTicketStatus("ai_suggested")).toBe(true);
    expect(isTicketStatus("resolved")).toBe(false);
  });
});
