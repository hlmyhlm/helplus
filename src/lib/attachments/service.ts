import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { currentCompanyId } from "@/lib/tenant/context";
import { encryptBuffer } from "@/lib/secrets";
import { attachmentKey, fileStore } from "@/lib/storage";
import { processAttachment } from "./process";

export const MAX_BYTES = 10 * 1024 * 1024;

// the original is written before the row so a row never points at nothing
export async function addAttachment(input: { ticketId: string; messageId?: string | null; fileName: string; data: Buffer }) {
  const id = randomUUID();
  const originalKey = attachmentKey(currentCompanyId(), id, "original");
  const store = fileStore();
  await store.put(originalKey, encryptBuffer(input.data));
  try {
    await prisma.attachment.create({
      data: {
        id,
        ticketId: input.ticketId,
        messageId: input.messageId ?? null,
        fileName: input.fileName.slice(0, 200) || "screenshot.png",
        originalKey,
      },
    });
  } catch (error) {
    await store.remove(originalKey);
    throw error;
  }
  return (await processAttachment(id))!;
}
