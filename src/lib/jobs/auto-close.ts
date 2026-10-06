import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { saveTicket, loadSlaContext } from "@/lib/tickets/update";
import { statusChange } from "@/lib/tickets/status";
import { buildEmail } from "@/lib/notify/templates";
import { queueEmail } from "@/lib/notify/outbox";
import { companyName } from "@/lib/notify/notify";
import { logger } from "@/lib/logger";

const DAY = 86_400_000;
const BATCH = 200;
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export async function runAutoClose(now: Date): Promise<{ closed: number; warned: number }> {
  const days = (await getSettings()).autoCloseDays;
  if (!days || days < 1) return { closed: 0, warned: 0 };

  const closeCutoff = new Date(now.getTime() - days * DAY);
  const due = await prisma.ticket.findMany({
    where: { status: "answered", answeredAt: { lte: closeCutoff } },
    take: BATCH,
  });
  const ctx = due.length ? await loadSlaContext() : undefined;
  let closed = 0;
  for (const t of due) {
    try {
      // the list above can be stale by the time we get here, a client reply moves the ticket on
      const fresh = await prisma.ticket.findFirst({ where: { id: t.id, status: "answered", answeredAt: { lte: closeCutoff } } });
      if (!fresh) continue;
      await saveTicket(fresh, statusChange(fresh, "closed", now), { now, ctx });
      if (fresh.conversationId) {
        await prisma.internalNote.create({
          data: {
            conversationId: fresh.conversationId,
            content: `Closed automatically after ${days} day${days === 1 ? "" : "s"} with no reply from the client.`,
            authorName: "Help+",
          },
        });
      }
      closed++;
    } catch (error) {
      logger.error(`auto-close couldn't close ticket ${t.id}`, error);
    }
  }

  let warned = 0;
  if (days >= 2) {
    const warnCutoff = new Date(now.getTime() - (days - 1) * DAY);
    const soon = await prisma.ticket.findMany({
      where: { status: "answered", closeWarnedAt: null, answeredAt: { lte: warnCutoff } },
      include: { conversation: { select: { customerContact: true, customer: { select: { email: true } } } } },
      take: BATCH,
    });
    const name = soon.length ? await companyName() : "";
    for (const t of soon) {
      try {
        const fresh = await prisma.ticket.findFirst({ where: { id: t.id, status: "answered", closeWarnedAt: null } });
        if (!fresh) continue;
        const contact = t.conversation?.customerContact ?? "";
        const customerEmail = t.conversation?.customer?.email ?? "";
        const to = looksLikeEmail(customerEmail) ? customerEmail : looksLikeEmail(contact) ? contact : "";
        if (to) {
          await queueEmail({ to, ...buildEmail("close_warning", t, { companyName: name, days }), kind: "close_warning", ticketId: t.id });
          warned++;
        }
        await prisma.ticket.update({ where: { id: t.id }, data: { closeWarnedAt: now } });
      } catch (error) {
        logger.error(`auto-close couldn't warn ticket ${t.id}`, error);
      }
    }
  }
  return { closed, warned };
}
