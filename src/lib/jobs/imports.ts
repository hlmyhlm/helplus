import { prisma } from "@/lib/prisma";
import { runImportBatch } from "@/lib/imports/run";

// one batch of the oldest open import per company, so a big file can't hog the worker
export async function runImports(now: Date): Promise<string | null> {
  const job = await prisma.importJob.findFirst({
    where: { status: { in: ["queued", "running"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!job) return null;
  return runImportBatch(job.id, now);
}
