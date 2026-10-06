import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { attachmentFolder, fileStore } from "@/lib/storage";

const SHOWABLE = new Set(["clean", "masked"]);

// the ai only ever gets a masked copy that staff can trust
export async function imageForAi(id: string): Promise<Buffer | null> {
  const a = await prisma.attachment.findUnique({ where: { id }, select: { status: true, maskedKey: true } });
  if (!a || !SHOWABLE.has(a.status) || !a.maskedKey) return null;
  return fileStore().get(a.maskedKey);
}

// call before deleting rows, the database cascade can't reach the disk
// the whole folder goes, so spare renders from a race don't outlive a delete
export async function removeAttachmentFiles(where: Record<string, unknown>): Promise<number> {
  const rows = await prisma.attachment.findMany({ where, select: { id: true, companyId: true } });
  const store = fileStore();
  for (const r of rows) {
    try {
      await store.removeFolder(attachmentFolder(r.companyId, r.id));
    } catch (error) {
      logger.error("couldn't remove attachment files", error);
    }
  }
  return rows.length;
}
