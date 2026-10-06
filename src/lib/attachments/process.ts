import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { logActivity } from "@/lib/activity";
import { currentCompanyId } from "@/lib/tenant/context";
import { decryptBuffer } from "@/lib/secrets";
import { attachmentKey, fileStore } from "@/lib/storage";
import { ocrImage } from "@/lib/ocr/tesseract";
import { coverBoxes, findIcBoxes, needsCheck, normalizeImage, type Box } from "@/lib/privacy/ic-image";

async function originalPng(originalKey: string) {
  return normalizeImage(decryptBuffer(await fileStore().get(originalKey)));
}

async function saveMasked(id: string, png: Buffer, boxes: Box[]): Promise<string> {
  const key = attachmentKey(currentCompanyId(), id, "masked");
  await fileStore().put(key, await coverBoxes(png, boxes));
  return key;
}

// api keys aren't admins, so there's no row to point at
const checker = (actor: { id: string }) => (actor.id.startsWith("api-key:") ? null : actor.id);

export async function processAttachment(id: string) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a || a.status !== "pending" || !a.originalKey) return a;
  const { png, width, height } = await originalPng(a.originalKey);
  try {
    const result = await ocrImage(png);
    const boxes = findIcBoxes(result.lines);
    const status = needsCheck(result) ? "needs_check" : boxes.length ? "masked" : "clean";
    return prisma.attachment.update({
      where: { id },
      data: {
        status,
        width,
        height,
        icCount: boxes.length,
        ocrConfidence: Math.round(result.confidence),
        autoBoxes: boxes as unknown as object,
        maskedKey: await saveMasked(id, png, boxes),
        checkNote: status === "needs_check" ? "OCR wasn't sure. Check for IC numbers." : "",
      },
    });
  } catch (error) {
    logger.error("ocr failed", error);
    return prisma.attachment.update({
      where: { id },
      data: { status: "needs_check", width, height, maskedKey: await saveMasked(id, png, []), checkNote: "OCR couldn't read this image." },
    });
  }
}

async function load(id: string) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a) throw new Error("attachment not found");
  if (!a.originalKey) throw new Error("the original was deleted");
  return { ...a, originalKey: a.originalKey };
}

// auto boxes stay, manual boxes go on top, always from the original
export async function remask(id: string, manualBoxes: Box[], actor: { id: string; name: string }) {
  const a = await load(id);
  const auto = (a.autoBoxes as unknown as Box[]) ?? [];
  const manual = [...((a.manualBoxes as unknown as Box[]) ?? []), ...manualBoxes];
  const { png } = await originalPng(a.originalKey);
  const updated = await prisma.attachment.update({
    where: { id },
    data: {
      status: "masked",
      manualBoxes: manual as unknown as object,
      icCount: auto.length + manual.length,
      maskedKey: await saveMasked(id, png, [...auto, ...manual]),
      checkedById: checker(actor),
      checkedAt: new Date(),
      checkNote: "",
    },
  });
  await logActivity("attachment.masked", "attachment", id, `Covered ${manualBoxes.length} area(s) on a screenshot`, actor.name);
  return updated;
}

export async function confirmAttachment(id: string, actor: { id: string; name: string }) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a) throw new Error("attachment not found");
  const updated = await prisma.attachment.update({
    where: { id },
    data: { status: a.icCount > 0 ? "masked" : "clean", checkedById: checker(actor), checkedAt: new Date(), checkNote: "" },
  });
  await logActivity("attachment.checked", "attachment", id, "Confirmed a screenshot has no visible IC", actor.name);
  return updated;
}
