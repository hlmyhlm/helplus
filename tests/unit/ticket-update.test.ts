import { describe, it, expect } from "vitest";
import { slaChanges, type SlaContext } from "@/lib/tickets/update";
import { ALWAYS_OPEN } from "@/lib/sla/calendar";
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
});
