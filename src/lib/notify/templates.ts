export type EmailKind = "new_ticket" | "reopened" | "sla_warning" | "sla_breach" | "close_warning";

export function ticketLink(id: string): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/tickets/${id}`;
}

const STAFF: Record<Exclude<EmailKind, "close_warning">, (n: number) => [string, string]> = {
  new_ticket: (n) => [`New ticket #${n}`, `Ticket #${n} was opened.`],
  reopened: (n) => [`Ticket #${n} was reopened`, `Ticket #${n} was reopened and is back with you.`],
  sla_warning: (n) => [`Ticket #${n} is due soon`, `Ticket #${n} is close to its SLA time.`],
  sla_breach: (n) => [`Ticket #${n} is overdue`, `Ticket #${n} has passed its SLA time.`],
};

// link only: never ticket text, it may hold client details
export function buildEmail(
  kind: EmailKind,
  t: { id: string; number: number },
  extra: { companyName: string; days?: number }
): { subject: string; body: string } {
  if (kind === "close_warning") {
    return {
      subject: `Your ticket #${t.number} closes tomorrow`,
      body: [
        "Hi,",
        "",
        `We answered your ticket #${t.number}. If you still need help, reply to us the same way you contacted us before tomorrow. Otherwise the ticket will close.`,
        "",
        extra.companyName,
      ].join("\n"),
    };
  }
  const [subject, line] = STAFF[kind](t.number);
  return { subject, body: [line, "", `Open it: ${ticketLink(t.id)}`, "", extra.companyName].join("\n") };
}
