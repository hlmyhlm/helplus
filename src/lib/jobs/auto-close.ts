import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { saveTicket, loadSlaContext } from "@/lib/tickets/update";
import { statusChange } from "@/lib/tickets/status";
import { buildEmail } from "@/lib/notify/templates";
import { queueEmail } from "@/lib/notify/outbox";
import { companyName } from "@/lib/notify/notify";

const DAY = 86_400_000;
const BATCH = 200;
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export async function runAutoClose(now: Date): Promise<{ closed: number; warned: number }> {
  const days = (await getSettings()).autoCloseDays;
  if (!days || days < 1) return { closed: 0, warned: 0 };

  const due = await prisma.ticket.findMany({
    where: { status: "answered", answeredAt: { lte: new Date(now.getTime() - days * DAY) } },
    take: BATCH,
  });
  const ctx = due.length ? await loadSlaContext() : undefined;
  for (const t of due) {
    await saveTicket(t, statusChange(t, "closed", now), { now, ctx });
    if (t.conversationId) {
      await prisma.internalNote.create({
        data: {
          conversationId: t.conversationId,
          content: `Closed automatically after ${days} day${days === 1 ? "" : "s"} with no reply from the client.`,
          authorName: "Help+",
        },
      });
    }
  }

  let warned = 0;
  if (days >= 2) {
    const soon = await prisma.ticket.findMany({
      where: { status: "answered", closeWarnedAt: null, answeredAt: { lte: new Date(now.getTime() - (days - 1) * DAY) } },
      include: { conversation: { select: { customerContact: true, customer: { select: { email: true } } } } },
      take: BATCH,
    });
    const name = soon.length ? await companyName() : "";
    for (const t of soon) {
      const contact = t.conversation?.customerContact ?? "";
      const to = t.conversation?.customer?.email || (looksLikeEmail(contact) ? contact : "");
      if (to) {
        await queueEmail({ to, ...buildEmail("close_warning", t, { companyName: name, days }), kind: "close_warning", ticketId: t.id });
        warned++;
      }
      await prisma.ticket.update({ where: { id: t.id }, data: { closeWarnedAt: now } });
    }
  }
  return { closed: due.length, warned };
}
