import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { currentCompanyId } from "@/lib/tenant/context";
import { maskIC } from "@/lib/privacy/ic-mask";
import { defaultProjectId } from "@/lib/projects/default";
import { fileStore, botMediaKey } from "@/lib/storage";
import { encryptBuffer } from "@/lib/secrets";
import { maskedFileName } from "@/lib/attachments/service";
import { isStaffSender, phoneDigits, senderDigits } from "./rules";

export interface IncomingEvent {
  waMessageId: string;
  chatWaId: string;
  chatName: string;
  isGroup: boolean;
  senderId: string;
  senderName: string;
  text: string;
  at: Date;
  quotedWaId: string | null;
  media: { data: Buffer; fileName: string; mime: string } | null;
}

const mask = (s: string, max: number) => maskIC(s).text.slice(0, max);
const isP2002 = (error: unknown) => (error as { code?: string })?.code === "P2002";

async function chatFor(e: IncomingEvent) {
  const name = mask(e.chatName, 200);
  const existing = await prisma.waChat.findFirst({ where: { waId: e.chatWaId } });
  if (existing) {
    return prisma.waChat.update({
      where: { id: existing.id },
      data: {
        name: name || existing.name,
        // late deliveries don't move it back
        lastMessageAt: existing.lastMessageAt && existing.lastMessageAt > e.at ? existing.lastMessageAt : e.at,
      },
    });
  }
  const projectId = e.isGroup ? null : await privateChatProject(e.senderId);
  try {
    return await prisma.waChat.create({
      data: { waId: e.chatWaId, name, isGroup: e.isGroup, projectId, lastMessageAt: e.at },
    });
  } catch (error) {
    // two messages from a new chat at once
    if (isP2002(error)) return prisma.waChat.findFirstOrThrow({ where: { waId: e.chatWaId } });
    throw error;
  }
}

async function privateChatProject(senderId: string): Promise<string> {
  const digits = senderDigits(senderId);
  // an empty contains would match every customer
  if (!digits) return defaultProjectId();
  const customers = await prisma.customer.findMany({
    where: { project: { archived: false } },
    select: { whatsapp: true, phone: true, projectId: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  const same = (stored: string) => stored !== "" && phoneDigits(stored.split("@")[0]) === digits;
  const match = customers.find((c) => same(c.whatsapp) || same(c.phone));
  return match?.projectId ?? defaultProjectId();
}

function mediaNote(media: NonNullable<IncomingEvent["media"]>): string {
  if (media.mime.startsWith("audio/ogg")) return "[voice message]";
  if (media.mime.startsWith("audio/")) return "[audio]";
  if (media.mime.startsWith("video/")) return "[video]";
  return `[document: ${maskedFileName(media.fileName || "file")}]`;
}

export async function recordInbound(
  e: IncomingEvent,
  botPhone: string
): Promise<"saved" | "duplicate" | "not_linked" | "skipped"> {
  const chat = await chatFor(e);
  if (!chat.projectId) return "not_linked";
  const image = e.media?.mime.startsWith("image/") ? e.media : null;
  let text = e.text.trim();
  if (e.media && !image) text = `${mediaNote(e.media)} ${text}`.trim();
  if (!text && !image) return "skipped";

  const [team, senders] = await Promise.all([
    prisma.teamMember.findMany({ select: { phone: true } }),
    prisma.chatSender.findMany({ where: { isStaff: true }, select: { name: true } }),
  ]);
  const senderName = mask(e.senderName, 120);
  const isStaff = isStaffSender(
    { senderId: e.senderId, senderName },
    {
      phones: new Set(team.map((t) => phoneDigits(t.phone)).filter(Boolean)),
      names: new Set(senders.map((s) => s.name).filter(Boolean)),
      botPhone,
    }
  );

  // the image goes first so a row never points at a missing file
  const id = randomUUID();
  const store = fileStore();
  const mediaKey = image ? botMediaKey(currentCompanyId(), id) : null;
  if (image && mediaKey) await store.put(mediaKey, encryptBuffer(image.data));

  try {
    await prisma.waInbound.create({
      data: {
        id,
        chatId: chat.id,
        waMessageId: e.waMessageId,
        senderId: e.senderId,
        senderName,
        isStaff,
        text: maskIC(text).text,
        at: e.at,
        quotedWaId: e.quotedWaId,
        mediaKey,
        mediaName: image ? maskedFileName(image.fileName || "whatsapp-image.jpg") : null,
      },
    });
  } catch (error) {
    if (mediaKey) await store.remove(mediaKey).catch(() => {});
    if (isP2002(error)) return "duplicate";
    throw error;
  }
  return "saved";
}
