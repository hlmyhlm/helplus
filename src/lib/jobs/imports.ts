import { prisma } from "@/lib/prisma";
import { fileStore } from "@/lib/storage";
import { logger } from "@/lib/logger";
import { runImportBatch } from "@/lib/imports/run";

const DAY = 86_400_000;
const STALE_UPLOAD_MS = 7 * DAY;
const STALE_FAILED_MS = 14 * DAY;

// the row goes first, so a file is only removed once nothing points at it
async function dropFile(fileKey: string) {
  try {
    await fileStore().remove(fileKey);
  } catch (error) {
    logger.error("couldn't remove an import file", error);
  }
}

// an upload nobody started in a week is dropped along with its file
export async function sweepStaleUploads(now: Date): Promise<number> {
  const stale = await prisma.importJob.findMany({
    where: { status: "uploaded", createdAt: { lt: new Date(now.getTime() - STALE_UPLOAD_MS) } },
    select: { id: true, fileKey: true },
    take: 100,
  });
  for (const job of stale) {
    try {
      const { count } = await prisma.importJob.deleteMany({ where: { id: job.id, status: "uploaded" } });
      if (count === 1 && job.fileKey) await dropFile(job.fileKey);
    } catch (error) {
      logger.error("couldn't remove a stale import upload", error);
    }
  }
  return stale.length;
}

// a failed import keeps its row but loses the file after two weeks
export async function sweepFailedUploads(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_FAILED_MS);
  const stale = await prisma.importJob.findMany({
    where: {
      status: "failed",
      fileKey: { not: null },
      OR: [{ finishedAt: { lt: cutoff } }, { finishedAt: null, createdAt: { lt: cutoff } }],
    },
    select: { id: true, fileKey: true },
    take: 100,
  });
  for (const job of stale) {
    try {
      const { count } = await prisma.importJob.updateMany({
        where: { id: job.id, status: "failed", fileKey: job.fileKey },
        data: { fileKey: null },
      });
      if (count === 1 && job.fileKey) await dropFile(job.fileKey);
    } catch (error) {
      logger.error("couldn't clear a failed import's file", error);
    }
  }
  return stale.length;
}

// one batch of the oldest open import per company, so a big file can't hog the worker
export async function runImports(now: Date): Promise<string | null> {
  await sweepStaleUploads(now);
  await sweepFailedUploads(now);
  const job = await prisma.importJob.findFirst({
    where: { status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!job) return null;
  return runImportBatch(job.id, now);
}
