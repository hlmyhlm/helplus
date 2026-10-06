import { addBusinessMinutes, type BusinessCalendar } from "./calendar";

export const WARN_SHARE = 0.8;

export interface SlaTimes {
  slaRuleId: string | null;
  firstReplyWarnAt: Date | null;
  firstReplyDueAt: Date | null;
  resolveWarnAt: Date | null;
  resolveDueAt: Date | null;
}

export type SlaState = "none" | "ok" | "near" | "breached" | "paused" | "met" | "missed";

export interface SlaTicket {
  status: string;
  firstReplyAt: Date | null;
  closedAt: Date | null;
  slaPausedAt: Date | null;
  firstReplyWarnAt: Date | null;
  firstReplyDueAt: Date | null;
  resolveWarnAt: Date | null;
  resolveDueAt: Date | null;
}

export function slaTimes(
  createdAt: Date,
  pausedMins: number,
  rule: { id: string; firstResponseMins: number; resolutionMins: number } | null,
  cal: BusinessCalendar
): SlaTimes {
  if (!rule) {
    return { slaRuleId: null, firstReplyWarnAt: null, firstReplyDueAt: null, resolveWarnAt: null, resolveDueAt: null };
  }
  const add = (mins: number) => addBusinessMinutes(createdAt, mins, cal);
  return {
    slaRuleId: rule.id,
    firstReplyWarnAt: add(Math.floor(rule.firstResponseMins * WARN_SHARE)),
    firstReplyDueAt: add(rule.firstResponseMins),
    resolveWarnAt: add(Math.floor(rule.resolutionMins * WARN_SHARE) + pausedMins),
    resolveDueAt: add(rule.resolutionMins + pausedMins),
  };
}

const passed = (at: Date | null, now: Date, inclusive = false) =>
  !!at && (inclusive ? at.getTime() <= now.getTime() : at.getTime() < now.getTime());

export function slaState(t: SlaTicket, now: Date): SlaState {
  if (!t.firstReplyDueAt && !t.resolveDueAt) return "none";
  if (t.status === "closed") {
    const end = t.closedAt ?? now;
    const lateReply = !!t.firstReplyDueAt && (t.firstReplyAt ?? end).getTime() > t.firstReplyDueAt.getTime();
    const lateClose = !!t.resolveDueAt && end.getTime() > t.resolveDueAt.getTime();
    return lateReply || lateClose ? "missed" : "met";
  }
  if (t.slaPausedAt) return "paused";
  const waitingReply = !t.firstReplyAt;
  if ((waitingReply && passed(t.firstReplyDueAt, now)) || passed(t.resolveDueAt, now)) return "breached";
  if ((waitingReply && passed(t.firstReplyWarnAt, now, true)) || passed(t.resolveWarnAt, now, true)) return "near";
  return "ok";
}

// prisma filters for the inbox and the alert job
export function slaWhere(state: "near" | "breached", now: Date): Record<string, unknown> {
  const running = { status: { not: "closed" }, slaPausedAt: null };
  const breached = { OR: [{ firstReplyAt: null, firstReplyDueAt: { lt: now } }, { resolveDueAt: { lt: now } }] };
  if (state === "breached") return { AND: [running, breached] };
  const near = { OR: [{ firstReplyAt: null, firstReplyWarnAt: { lte: now } }, { resolveWarnAt: { lte: now } }] };
  return { AND: [running, near, { NOT: breached }] };
}
