import { describe, it, expect } from "vitest";
import { senderDigits, phoneDigits, isStaffSender, plan, placeUnquoted, QUIET_MS, FOLLOW_UP_MS } from "@/lib/bot/rules";

const t0 = new Date("2026-10-11T02:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const msg = (id: string, senderId: string, ms: number, isStaff = false, quotedWaId: string | null = null) => ({
  id, senderId, isStaff, at: at(ms), quotedWaId,
});

describe("numbers", () => {
  it("reads digits from wa ids and phones", () => {
    expect(senderDigits("60123456789@c.us")).toBe("60123456789");
    expect(phoneDigits("012-345 6789")).toBe("60123456789");
    expect(phoneDigits("+60 12-345 6789")).toBe("60123456789");
    expect(phoneDigits("")).toBe("");
  });
});

describe("isStaffSender", () => {
  const staff = { phones: new Set(["60123456789"]), names: new Set(["Support Ali"]), botPhone: "60111111111" };
  it("matches team phones and staff names", () => {
    expect(isStaffSender({ senderId: "60123456789@c.us", senderName: "Ali" }, staff)).toBe(true);
    expect(isStaffSender({ senderId: "60199999999@c.us", senderName: "Support Ali" }, staff)).toBe(true);
    expect(isStaffSender({ senderId: "60199999999@c.us", senderName: "Aminah" }, staff)).toBe(false);
  });
  it("never counts the bot itself", () => {
    expect(isStaffSender({ senderId: "60111111111@c.us", senderName: "Support Ali" }, staff)).toBe(false);
  });
});

describe("plan", () => {
  it("waits until a client has been quiet for 2 minutes", () => {
    const p = [msg("a", "c1", 0), msg("b", "c1", 30_000)];
    expect(plan(p, at(30_000 + QUIET_MS - 1))).toEqual([]);
    expect(plan(p, at(30_000 + QUIET_MS))).toEqual([{ kind: "client", senderId: "c1", ids: ["a", "b"] }]);
  });

  it("keeps clients apart", () => {
    const p = [msg("a", "c1", 0), msg("b", "c2", 10_000)];
    expect(plan(p, at(10 * 60_000))).toEqual([
      { kind: "client", senderId: "c1", ids: ["a"] },
      { kind: "client", senderId: "c2", ids: ["b"] },
    ]);
  });

  it("flushes earlier client messages before a staff message, even when not quiet", () => {
    const p = [msg("a", "c1", 0), msg("s", "st", 20_000, true), msg("b", "c1", 40_000)];
    expect(plan(p, at(50_000))).toEqual([
      { kind: "client", senderId: "c1", ids: ["a"] },
      { kind: "staff", id: "s" },
    ]);
  });

  it("handles staff messages in time order", () => {
    const p = [msg("s2", "st", 5_000, true), msg("s1", "st", 1_000, true)];
    expect(plan(p, at(6_000))).toEqual([{ kind: "staff", id: "s1" }, { kind: "staff", id: "s2" }]);
  });

  it("keeps a client message after a staff reply out of the earlier batch", () => {
    const p = [msg("a", "c1", 0), msg("s", "st", 20_000, true), msg("b", "c1", 40_000)];
    expect(plan(p, at(40_000 + QUIET_MS))).toEqual([
      { kind: "client", senderId: "c1", ids: ["a"] },
      { kind: "staff", id: "s" },
      { kind: "client", senderId: "c1", ids: ["b"] },
    ]);
  });
});

describe("placeUnquoted", () => {
  it("uses the only ticket active in the last 4 hours", () => {
    expect(placeUnquoted([{ id: "t1", lastActivityAt: at(0) }], at(FOLLOW_UP_MS - 1))).toEqual({ ticketId: "t1" });
  });
  it("asks staff when there are several", () => {
    const open = [{ id: "t1", lastActivityAt: at(0) }, { id: "t2", lastActivityAt: at(1000) }];
    expect(placeUnquoted(open, at(2000))).toBe("pick");
  });
  it("ignores staff chatter with nothing open recently", () => {
    expect(placeUnquoted([], at(0))).toBe("ignore");
    expect(placeUnquoted([{ id: "t1", lastActivityAt: at(0) }], at(FOLLOW_UP_MS + 1))).toBe("ignore");
  });
});
