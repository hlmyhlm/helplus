import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { slaChanges, saveTicket, type SlaContext } from "@/lib/tickets/update";
import { ALWAYS_OPEN, businessMinutesBetween, type BusinessCalendar } from "@/lib/sla/calendar";
import { slaTimes } from "@/lib/sla/clock";

const created = new Date("2026-10-05T00:00:00Z");
const min = (n: number) => new Date(created.getTime() + n * 60_000);
const rule = {
  id: "r1",
  companyId: "c",
  name: "default",
  description: "",
  projectId: null,
  priority: "all",
  category: "all",
  source: "all",
  firstResponseMins: 100,
  resolutionMins: 1000,
  isActive: true,
  createdAt: created,
  updatedAt: created,
};
const urgent = { ...rule, id: "r2", priority: "urgent", firstResponseMins: 10, resolutionMins: 100 };
const ctx: SlaContext = { rules: [rule, urgent], cal: ALWAYS_OPEN };
const ticket = {
  id: "t1",
  status: "working",
  priority: "medium",
  projectId: "p1",
  category: "",
  source: "whatsapp",
  createdAt: created,
  closedAt: null,
  firstReplyAt: min(5),
  slaPausedAt: null,
  slaPausedMins: 0,
  slaWarnedAt: null,
  slaBreachedAt: null,
  closeWarnedAt: null,
  ...slaTimes(created, 0, rule, ALWAYS_OPEN),
} as never;

describe("slaChanges", () => {
  it("pauses when the ticket is answered", () => {
    expect(slaChanges(ticket, { status: "answered" }, ctx, min(200))).toMatchObject({ slaPausedAt: min(200) });
  });

  it("drops an old close warning when the ticket is answered again", () => {
    const warned = { ...(ticket as object), closeWarnedAt: min(100) } as never;
    expect(slaChanges(warned, { status: "answered" }, ctx, min(200))).toMatchObject({ closeWarnedAt: null });
  });

  it("adds the paused time when the ticket leaves answered", () => {
    const answered = { ...(ticket as object), status: "answered", slaPausedAt: min(200) } as never;
    const out = slaChanges(answered, { status: "working" }, ctx, min(500));
    expect(out).toMatchObject({ slaPausedAt: null, slaPausedMins: 300, resolveDueAt: min(1300), closeWarnedAt: null });
  });

  it("adds the closed time on reopen", () => {
    const closed = { ...(ticket as object), status: "closed", closedAt: min(400) } as never;
    expect(slaChanges(closed, { status: "reopened", closedAt: null }, ctx, min(600))).toMatchObject({ slaPausedMins: 200 });
  });

  it("picks a new rule when the priority changes", () => {
    expect(slaChanges(ticket, { priority: "urgent" }, ctx, min(1))).toMatchObject({ slaRuleId: "r2", resolveDueAt: min(100) });
  });

  it("clears old alerts once the ticket is back on time", () => {
    const late = { ...(ticket as object), slaBreachedAt: min(1001), slaWarnedAt: min(801), status: "answered", slaPausedAt: min(50) } as never;
    expect(slaChanges(late, { status: "working" }, ctx, min(1100))).toMatchObject({ slaWarnedAt: null, slaBreachedAt: null });
  });

  it("does nothing for unrelated changes", () => {
    expect(slaChanges(ticket, { title: "new title" }, ctx, min(1))).toEqual({});
  });

  it("leaves a legacy ticket without a rule without times when it reopens", () => {
    const legacy = {
      ...(ticket as object),
      status: "closed",
      closedAt: min(400),
      slaRuleId: null,
      firstReplyWarnAt: null,
      firstReplyDueAt: null,
      resolveWarnAt: null,
      resolveDueAt: null,
    } as never;
    const out = slaChanges(legacy, { status: "reopened", closedAt: null }, ctx, min(600));
    expect(out).toMatchObject({ slaPausedMins: 200 });
    expect(out.resolveDueAt).toBeUndefined();
    expect(out.resolveWarnAt).toBeUndefined();
    expect(out.firstReplyDueAt).toBeUndefined();
  });

  it("keeps its own targets when its rule isn't in context anymore", () => {
    const answered = { ...(ticket as object), status: "answered", slaPausedAt: min(200) } as never;
    const noRuleCtx: SlaContext = { rules: [urgent], cal: ALWAYS_OPEN };
    const out = slaChanges(answered, { status: "working" }, noRuleCtx, min(500));
    expect(out).toMatchObject({ slaPausedAt: null, slaPausedMins: 300, resolveDueAt: min(1300) });
  });

  it("accrues the pause when an answered ticket closes", () => {
    const answered = { ...(ticket as object), status: "answered", slaPausedAt: min(200) } as never;
    const out = slaChanges(answered, { status: "closed", closedAt: min(500) }, ctx, min(500));
    expect(out).toMatchObject({ slaPausedAt: null, slaPausedMins: 300 });
  });

  it("still shifts due times after its rule was deleted", () => {
    const orphan = { ...(ticket as object), status: "answered", slaPausedAt: min(200), slaRuleId: null } as never;
    const out = slaChanges(orphan, { status: "working" }, ctx, min(500));
    expect(out).toMatchObject({ slaPausedMins: 300, resolveDueAt: min(1300), resolveWarnAt: min(1100) });
  });

  it("shifts by business minutes on a business calendar", () => {
    const nineToSix: [number, number] = [540, 1080];
    const cal: BusinessCalendar = {
      enabled: true,
      timezone: "Asia/Kuala_Lumpur",
      week: [null, nineToSix, nineToSix, nineToSix, nineToSix, nineToSix, null],
      holidays: new Set(),
    };
    const pausedAt = new Date("2026-10-05T03:00:00Z");
    const now = new Date("2026-10-07T05:30:00Z");
    const answered = {
      ...(ticket as object),
      status: "answered",
      slaPausedAt: pausedAt,
      ...slaTimes(created, 0, rule, cal),
    } as never;
    const out = slaChanges(answered, { status: "working" }, { rules: [rule], cal }, now);
    const paused = businessMinutesBetween(pausedAt, now, cal);
    expect(paused).toBeGreaterThan(0);
    expect(out.slaPausedMins).toBe(paused);
    expect(out.resolveDueAt).toEqual(slaTimes(created, paused, rule, cal).resolveDueAt);
  });

  it("clears a first reply warning once staff reply", () => {
    const waiting = { ...(ticket as object), firstReplyAt: null, slaWarnedAt: min(85) } as never;
    expect(slaChanges(waiting, { firstReplyAt: min(90) }, ctx, min(90))).toEqual({ slaWarnedAt: null, slaBreachedAt: null });
  });
});

describe("saveTicket", () => {
  it("clears first reply alerts without loading the sla context", async () => {
    const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
    db.ticket.update.mockReset().mockResolvedValue({ id: "t1" });
    db.sLARule.findMany.mockReset();
    const waiting = { ...(ticket as object), firstReplyAt: null, slaWarnedAt: min(85), slaBreachedAt: min(101) } as never;
    await saveTicket(waiting, { firstReplyAt: min(120) }, { now: min(120) });
    expect(db.sLARule.findMany).not.toHaveBeenCalled();
    expect(db.ticket.update.mock.calls[0][0].data).toMatchObject({ firstReplyAt: min(120), slaWarnedAt: null, slaBreachedAt: null });
  });
});
