export const TICKET_STATUSES = ["new", "ai_suggested", "answered", "reopened", "working", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const OPEN_STATUSES: TicketStatus[] = ["new", "ai_suggested", "answered", "reopened", "working"];

export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: "New",
  ai_suggested: "AI Suggested",
  answered: "Answered",
  reopened: "Reopened",
  working: "Staff working",
  closed: "Closed",
};

// which step can follow which. closed only goes back via reopened.
const ALLOWED: Record<TicketStatus, TicketStatus[]> = {
  new: ["ai_suggested", "working", "answered", "closed"],
  ai_suggested: ["working", "answered", "closed"],
  answered: ["reopened", "working", "closed"],
  reopened: ["working", "answered", "closed"],
  working: ["answered", "closed"],
  closed: ["reopened"],
};

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`can't move a ticket from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function isTicketStatus(v: unknown): v is TicketStatus {
  return typeof v === "string" && (TICKET_STATUSES as readonly string[]).includes(v);
}

// same rule as statusChange, for the UI pickers
export function canMove(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return false;
  return ALLOWED[from].includes(to);
}

export function statusChange(
  current: { status: string; firstReplyAt: Date | null; reopenCount: number },
  to: TicketStatus,
  now: Date = new Date()
): Record<string, unknown> {
  const from: TicketStatus = isTicketStatus(current.status) ? current.status : "new";
  if (from === to) return {};
  if (!ALLOWED[from].includes(to)) throw new InvalidTransitionError(from, to);

  const data: Record<string, unknown> = { status: to };
  if (to === "answered") {
    data.answeredAt = now;
    if (!current.firstReplyAt) data.firstReplyAt = now;
  }
  if (to === "closed") data.closedAt = now;
  if (to === "reopened") {
    data.reopenCount = current.reopenCount + 1;
    data.closedAt = null;
  }
  return data;
}
