import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { buildEmail, type TicketAlertKind } from "./templates";
import { recipientsFor } from "./recipients";
import { queueEmail } from "./outbox";

export async function companyName(): Promise<string> {
  const c = await prisma.company.findFirst({ select: { name: true } });
  return c?.name || "Help+";
}

// alerts must never break the request that caused them
export async function notifyTicket(
  kind: TicketAlertKind,
  t: { id: string; number: number; projectId: string; assigneeId: string | null },
  opts: { actorId?: string } = {}
): Promise<void> {
  try {
    const to = await recipientsFor(kind, t, opts.actorId);
    if (!to.length) return;
    const email = buildEmail(kind, t, { companyName: await companyName() });
    for (const address of to) await queueEmail({ to: address, ...email, kind, ticketId: t.id });
  } catch (error) {
    logger.error(`couldn't queue ${kind} email`, error);
  }
}
