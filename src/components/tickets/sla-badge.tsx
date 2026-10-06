import { slaState, type SlaState, type SlaTicket } from "@/lib/sla/clock";

const LABELS: Partial<Record<SlaState, { text: string; tone: string }>> = {
  near: { text: "Due soon", tone: "#F79009" },
  breached: { text: "Overdue", tone: "#D92D20" },
  paused: { text: "Waiting on client", tone: "#98A2B3" },
};

export function slaLabel(state: SlaState): { text: string; tone: string } | null {
  return LABELS[state] ?? null;
}

export function closesOn(answeredAt: string | null, days: number, closeWarnedAt?: string | null): Date | null {
  if (!answeredAt || days < 1) return null;
  const byDays = new Date(answeredAt).getTime() + days * 86_400_000;
  const byWarning = closeWarnedAt ? new Date(closeWarnedAt).getTime() + 86_400_000 : 0;
  return new Date(Math.max(byDays, byWarning));
}

type Dates = Record<keyof Omit<SlaTicket, "status">, string | null>;

export function toSlaTicket(t: { status: string } & Dates): SlaTicket {
  const d = (v: string | null) => (v ? new Date(v) : null);
  return {
    status: t.status,
    firstReplyAt: d(t.firstReplyAt),
    closedAt: d(t.closedAt),
    slaPausedAt: d(t.slaPausedAt),
    firstReplyWarnAt: d(t.firstReplyWarnAt),
    firstReplyDueAt: d(t.firstReplyDueAt),
    resolveWarnAt: d(t.resolveWarnAt),
    resolveDueAt: d(t.resolveDueAt),
  };
}

export function SlaBadge({ ticket, showPaused = false }: { ticket: { status: string } & Dates; showPaused?: boolean }) {
  const state = slaState(toSlaTicket(ticket), new Date());
  const label = slaLabel(state);
  if (!label || (state === "paused" && !showPaused)) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-helplus-text whitespace-nowrap">
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: label.tone }} />
      {label.text}
    </span>
  );
}
