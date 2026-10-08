import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { logActivity } from "@/lib/activity";
import { currentCompanyId } from "@/lib/tenant/context";
import { decryptBuffer } from "@/lib/secrets";
import { attachmentKey, fileStore } from "@/lib/storage";
import { ocrImage } from "@/lib/ocr/tesseract";
import { coverBoxes, findIcBoxes, needsCheck, normalizeImage, type Box, type OcrResult } from "@/lib/privacy/ic-image";

async function originalPng(originalKey: string) {
  return normalizeImage(decryptBuffer(await fileStore().get(originalKey)));
}

async function saveMasked(id: string, png: Buffer, boxes: Box[]): Promise<string> {
  const key = attachmentKey(currentCompanyId(), id, "masked", randomUUID());
  await fileStore().put(key, await coverBoxes(png, boxes));
  return key;
}

async function dropRender(key: string | null) {
  if (!key) return;
  try {
    await fileStore().remove(key);
  } catch (error) {
    logger.error("couldn't remove an old masked render", error);
  }
}

// api keys aren't admins, so there's no row to point at
const checker = (actor: { id: string }) => (actor.id.startsWith("api-key:") ? null : actor.id);

type Outcome = { status: string; checkNote: string; [field: string]: unknown };

// only a row that's still pending takes the result, so a second run can't undo a check
async function finish(id: string, data: Outcome, maskedKey: string | null) {
  const { count } = await prisma.attachment.updateMany({ where: { id, status: "pending" }, data: { ...data, maskedKey } });
  // lost the race, so this run's render belongs to nobody
  if (!count) await dropRender(maskedKey);
  return prisma.attachment.findUnique({ where: { id } });
}

// needs_check never gets a masked copy, staff review it from the encrypted original
export async function processAttachment(id: string) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a || a.status !== "pending" || !a.originalKey) return a;
  let image: Awaited<ReturnType<typeof originalPng>>;
  try {
    image = await originalPng(a.originalKey);
  } catch (error) {
    // leave it for staff, otherwise the worker retries it forever
    logger.error("couldn't read attachment original", error);
    return finish(id, { status: "needs_check", checkNote: "Couldn't read the original file." }, null);
  }
  const { png, width, height } = image;
  let result: OcrResult;
  try {
    result = await ocrImage(png);
  } catch (error) {
    logger.error("ocr failed", error);
    return finish(id, { status: "needs_check", width, height, autoBoxes: [], checkNote: "OCR couldn't read this image." }, null);
  }
  const boxes = findIcBoxes(result.lines);
  const status = needsCheck(result) ? "needs_check" : boxes.length ? "masked" : "clean";
  const data = {
    status,
    width,
    height,
    icCount: boxes.length,
    ocrConfidence: Math.round(result.confidence),
    autoBoxes: boxes as unknown as object,
    checkNote: status === "needs_check" ? "OCR wasn't sure. Check for IC numbers." : "",
  };
  return finish(id, data, status === "needs_check" ? null : await saveMasked(id, png, boxes));
}

async function load(id: string) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a) throw new Error("attachment not found");
  if (!a.originalKey) throw new Error("the original was deleted");
  return { ...a, originalKey: a.originalKey };
}

const boxesOf = (value: unknown) => (Array.isArray(value) ? (value as Box[]) : []);

type Loaded = Awaited<ReturnType<typeof load>>;

// only write if nobody touched the row since we read it, otherwise our render goes
async function swapRender(a: Loaded, data: Record<string, unknown>, maskedKey: string) {
  const { count } = await prisma.attachment.updateMany({
    where: { id: a.id, maskedKey: a.maskedKey, updatedAt: a.updatedAt },
    data: { ...data, maskedKey },
  });
  if (!count) {
    await dropRender(maskedKey);
    throw new Error("changed by someone else");
  }
  await dropRender(a.maskedKey);
  return (await prisma.attachment.findUnique({ where: { id: a.id } }))!;
}

// auto boxes stay and manual ones go on top, always rendered from the original
export async function remask(id: string, manualBoxes: Box[], actor: { id: string; name: string }) {
  const a = await load(id);
  const auto = boxesOf(a.autoBoxes);
  const manual = [...boxesOf(a.manualBoxes), ...manualBoxes];
  const { png } = await originalPng(a.originalKey);
  const data = {
    status: "masked",
    manualBoxes: manual as unknown as object,
    icCount: auto.length + manual.length,
    checkedById: checker(actor),
    checkedAt: new Date(),
    checkNote: "",
  };
  const updated = await swapRender(a, data, await saveMasked(id, png, [...auto, ...manual]));
  await logActivity("attachment.masked", "attachment", id, `Covered ${manualBoxes.length} area(s) on a screenshot`, actor.name);
  return updated;
}

// the masked copy for a needs_check image is only made once someone has looked
export async function confirmAttachment(id: string, actor: { id: string; name: string }) {
  const a = await load(id);
  const { png } = await originalPng(a.originalKey);
  const data = {
    status: a.icCount > 0 ? "masked" : "clean",
    checkedById: checker(actor),
    checkedAt: new Date(),
    checkNote: "",
  };
  const updated = await swapRender(a, data, await saveMasked(id, png, [...boxesOf(a.autoBoxes), ...boxesOf(a.manualBoxes)]));
  await logActivity("attachment.checked", "attachment", id, `Checked a screenshot, ${a.icCount} IC covered`, actor.name);
  return updated;
}
