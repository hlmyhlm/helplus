import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { fileStore } from "@/lib/storage";

const SHOWABLE = new Set(["clean", "masked"]);

// the ai only ever gets a masked copy that staff can trust
export async function imageForAi(id: string): Promise<Buffer | null> {
  const a = await prisma.attachment.findUnique({ where: { id }, select: { status: true, maskedKey: true } });
  if (!a || !SHOWABLE.has(a.status) || !a.maskedKey) return null;
  return fileStore().get(a.maskedKey);
}

// call before deleting rows, the database cascade can't reach the disk
export async function removeAttachmentFiles(where: Record<string, unknown>): Promise<number> {
  const rows = await prisma.attachment.findMany({ where, select: { originalKey: true, maskedKey: true } });
  const store = fileStore();
  for (const r of rows) {
    for (const key of [r.originalKey, r.maskedKey]) {
      if (!key) continue;
      try {
        await store.remove(key);
      } catch (error) {
        logger.error("couldn't remove attachment file", error);
      }
    }
  }
  return rows.length;
}
