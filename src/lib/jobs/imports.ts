import { prisma } from "@/lib/prisma";
import { fileStore } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { runImportBatch } from "@/lib/imports/run";

const STALE_UPLOAD_MS = 7 * 86_400_000;

// an upload nobody started in a week is dropped along with its file
export async function sweepStaleUploads(now: Date): Promise<number> {
  const stale = await prisma.importJob.findMany({
    where: { status: "uploaded", createdAt: { lt: new Date(now.getTime() - STALE_UPLOAD_MS) } },
    select: { id: true, fileKey: true },
    take: 100,
  });
  for (const job of stale) {
    try {
      if (job.fileKey) await fileStore().remove(job.fileKey);
      await prisma.importJob.deleteMany({ where: { id: job.id, status: "uploaded" } });
    } catch (error) {
      logger.error("couldn't remove a stale import upload", error);
    }
  }
  return stale.length;
}

// one batch of the oldest open import per company, so a big file can't hog the worker
export async function runImports(now: Date): Promise<string | null> {
  await sweepStaleUploads(now);
  const job = await prisma.importJob.findFirst({
    where: { status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!job) return null;
  return runImportBatch(job.id, now);
}
