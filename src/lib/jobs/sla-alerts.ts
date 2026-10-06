import { prisma } from "@/lib/prisma";
import { slaWhere } from "@/lib/sla/clock";
import { notifyTicket } from "@/lib/notify/notify";

const BATCH = 200;

export async function runSlaAlerts(now: Date): Promise<{ warned: number; breached: number }> {
  const breached = await prisma.ticket.findMany({ where: { AND: [slaWhere("breached", now), { slaBreachedAt: null }] }, take: BATCH });
  for (const t of breached) {
    await notifyTicket("sla_breach", t);
    await prisma.ticket.update({ where: { id: t.id }, data: { slaBreachedAt: now, slaWarnedAt: t.slaWarnedAt ?? now } });
  }
  const near = await prisma.ticket.findMany({ where: { AND: [slaWhere("near", now), { slaWarnedAt: null }] }, take: BATCH });
  for (const t of near) {
    await notifyTicket("sla_warning", t);
    await prisma.ticket.update({ where: { id: t.id }, data: { slaWarnedAt: now } });
  }
  return { warned: near.length, breached: breached.length };
}
