import type { SLARule, Ticket } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { businessMinutesBetween, type BusinessCalendar } from "@/lib/sla/calendar";
import { loadCalendar } from "@/lib/sla/load-calendar";
import { pickRule } from "@/lib/sla/rules";
import { slaState, slaTimes, type SlaTicket } from "@/lib/sla/clock";

export interface SlaContext {
  rules: SLARule[];
  cal: BusinessCalendar;
}

const SLA_INPUTS = ["priority", "projectId", "category", "source"] as const;

export async function loadSlaContext(): Promise<SlaContext> {
  const [rules, cal] = await Promise.all([prisma.sLARule.findMany({ where: { isActive: true } }), loadCalendar()]);
  return { rules, cal };
}

// the sla fields that go with a change, kept pure for tests
export function slaChanges(before: Ticket, data: Record<string, unknown>, ctx: SlaContext, now: Date): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const next = { ...before, ...data } as Ticket;
  let pausedMins = before.slaPausedMins;

  if (before.status === "answered" && next.status !== "answered") {
    if (before.slaPausedAt) pausedMins += businessMinutesBetween(before.slaPausedAt, now, ctx.cal);
    out.slaPausedAt = null;
    out.closeWarnedAt = null;
  }
  if (before.status === "closed" && next.status !== "closed" && before.closedAt) {
    pausedMins += businessMinutesBetween(before.closedAt, now, ctx.cal);
  }
  if (next.status === "answered" && before.status !== "answered") out.slaPausedAt = now;

  const inputsChanged = SLA_INPUTS.some((k) => k in data && data[k] !== before[k]);
  if (pausedMins !== before.slaPausedMins || inputsChanged) {
    out.slaPausedMins = pausedMins;
    Object.assign(out, slaTimes(before.createdAt, pausedMins, pickRule(ctx.rules, next), ctx.cal));
    const state = slaState({ ...next, ...out } as SlaTicket, now);
    if (state === "ok" || state === "paused") {
      out.slaWarnedAt = null;
      out.slaBreachedAt = null;
    } else if (state === "near") {
      out.slaBreachedAt = null;
    }
  }
  return out;
}

// every status, priority, project, category or source change goes through here
export async function saveTicket(
  before: Ticket,
  data: Record<string, unknown>,
  opts: { now?: Date; ctx?: SlaContext; actorId?: string; db?: Pick<typeof prisma, "ticket"> } = {}
): Promise<Ticket> {
  const now = opts.now ?? new Date();
  const ctx = opts.ctx ?? (await loadSlaContext());
  const db = opts.db ?? prisma;
  return db.ticket.update({ where: { id: before.id }, data: { ...data, ...slaChanges(before, data, ctx, now) } });
}
