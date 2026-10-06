import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { logger } from "@/lib/logger";
import { fileStore } from "@/lib/storage";
import { processAttachment } from "@/lib/attachments/process";

const DAY = 86_400_000;
const STALE_PENDING_MS = 5 * 60_000;
const BATCH = 20;

// uploads normally finish inside the request, this picks up the ones that didn't
export async function runPendingAttachments(now: Date): Promise<number> {
  const rows = await prisma.attachment.findMany({
    where: { status: "pending", createdAt: { lte: new Date(now.getTime() - STALE_PENDING_MS) } },
    select: { id: true },
    take: BATCH,
  });
  for (const r of rows) {
    try {
      await processAttachment(r.id);
    } catch (error) {
      logger.error("retrying attachment failed", error);
    }
  }
  return rows.length;
}

export async function runOriginalRetention(now: Date): Promise<number> {
  const days = (await getSettings()).originalRetentionDays;
  const rows = await prisma.attachment.findMany({
    where: {
      originalKey: { not: null },
      ticket: { status: "closed", closedAt: { lte: new Date(now.getTime() - days * DAY) } },
    },
    select: { id: true, originalKey: true },
    take: 200,
  });
  for (const r of rows) {
    try {
      await fileStore().remove(r.originalKey!);
      await prisma.attachment.update({ where: { id: r.id }, data: { originalKey: null, originalDeletedAt: now } });
    } catch (error) {
      logger.error("couldn't delete an expired original", error);
    }
  }
  return rows.length;
}
