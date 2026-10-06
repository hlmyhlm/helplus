import { describe, it, expect } from "vitest";
import { statusChange, canMove, InvalidTransitionError, isTicketStatus, OPEN_STATUSES, TICKET_STATUSES } from "@/lib/tickets/status";

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

describe("canMove", () => {
  it("never allows moving to the same status", () => {
    for (const s of TICKET_STATUSES) expect(canMove(s, s)).toBe(false);
  });

  it("matches the server's allowed transitions", () => {
    expect(canMove("new", "ai_suggested")).toBe(true);
    expect(canMove("new", "working")).toBe(true);
    expect(canMove("new", "answered")).toBe(true);
    expect(canMove("new", "closed")).toBe(true);
    expect(canMove("new", "reopened")).toBe(false);

    expect(canMove("ai_suggested", "working")).toBe(true);
    expect(canMove("ai_suggested", "answered")).toBe(true);
    expect(canMove("ai_suggested", "closed")).toBe(true);
    expect(canMove("ai_suggested", "new")).toBe(false);

    expect(canMove("answered", "reopened")).toBe(true);
    expect(canMove("answered", "working")).toBe(true);
    expect(canMove("answered", "closed")).toBe(true);
    expect(canMove("answered", "new")).toBe(false);

    expect(canMove("reopened", "working")).toBe(true);
    expect(canMove("reopened", "answered")).toBe(true);
    expect(canMove("reopened", "closed")).toBe(true);
    expect(canMove("reopened", "new")).toBe(false);

    expect(canMove("working", "answered")).toBe(true);
    expect(canMove("working", "closed")).toBe(true);
    expect(canMove("working", "new")).toBe(false);
    expect(canMove("working", "reopened")).toBe(false);

    expect(canMove("closed", "reopened")).toBe(true);
    expect(canMove("closed", "new")).toBe(false);
    expect(canMove("closed", "working")).toBe(false);
  });
});
