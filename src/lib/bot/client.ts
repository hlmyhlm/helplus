import { Client, LocalAuth, type Message } from "whatsapp-web.js";
import * as qrcode from "qrcode";
import { logger } from "@/lib/logger";
import type { IncomingEvent } from "./record";

// the only file that touches whatsapp-web.js, and it only listens
export interface BotHandle {
  stop(unlink: boolean): Promise<void>;
}

export interface BotHooks {
  onQr(dataUrl: string): Promise<void>;
  onReady(phone: string): Promise<void>;
  onDown(reason: string): Promise<void>;
  onMessage(e: IncomingEvent): Promise<void>;
}

// newer whatsapp gives some senders as @lid, which has no phone number in it
async function sender(message: Message, raw: string): Promise<{ id: string; name: string }> {
  try {
    const contact = await message.getContact();
    const name = contact.pushname || contact.name || "";
    if (!raw.endsWith("@lid")) return { id: raw, name };
    const lid = raw.split("@")[0];
    const number = contact.id?.server === "c.us" ? contact.id.user : contact.number;
    return { id: number && /^\d+$/.test(number) && number !== lid ? `${number}@c.us` : raw, name };
  } catch {
    return { id: raw, name: "" };
  }
}

// stickers, reactions, deleted messages and system events never become tickets
const SKIP = new Set([
  "sticker",
  "reaction",
  "revoked",
  "call_log",
  "ciphertext",
  "debug",
  "e2e_notification",
  "gp2",
  "group_notification",
  "notification",
  "notification_template",
  "broadcast_notification",
  "protocol",
]);

// these bodies can hold a base64 thumbnail or raw vcard
const PLACEHOLDER: Record<string, string> = {
  location: "[location]",
  vcard: "[contact card]",
  multi_vcard: "[contact card]",
};

export async function toEvent(message: Message): Promise<IncomingEvent | null> {
  const type = String(message.type ?? "");
  if (message.fromMe || message.isStatus || message.broadcast || SKIP.has(type)) return null;
  const chat = await message.getChat();
  const chatWaId = chat.id._serialized;
  if (chatWaId === "status@broadcast") return null;
  const who = await sender(message, message.author ?? message.from);
  const quoted = message.hasQuotedMsg ? await message.getQuotedMessage() : null;
  const placeholder = PLACEHOLDER[type];
  const media = message.hasMedia && !placeholder ? await message.downloadMedia() : null;
  return {
    waMessageId: message.id._serialized,
    chatWaId,
    chatName: chat.name ?? "",
    isGroup: chat.isGroup,
    senderId: who.id,
    senderName: who.name,
    text: placeholder ?? message.body ?? "",
    at: new Date(message.timestamp * 1000),
    quotedWaId: quoted?.id?._serialized ?? null,
    media: media ? { data: Buffer.from(media.data, "base64"), fileName: media.filename ?? "", mime: media.mimetype } : null,
  };
}

export async function startClient(companyId: string, hooks: BotHooks): Promise<BotHandle> {
  const client = new Client({
    // default keeps the old unnamed session folder, so a linked session still works
    authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth", clientId: companyId === "default" ? undefined : companyId }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    },
  });

  const safely = (what: string, fn: () => Promise<void>) =>
    fn().catch((error) => logger.error(`[bot] ${what} failed for ${companyId}`, error));

  client.on("qr", (qr: string) => safely("qr", async () => hooks.onQr(await qrcode.toDataURL(qr))));
  client.on("ready", () => safely("ready", () => hooks.onReady(client.info.wid.user)));
  client.on("disconnected", (reason: unknown) => safely("disconnect", () => hooks.onDown(String(reason))));
  client.on("auth_failure", (message: string) => safely("auth failure", () => hooks.onDown(String(message))));
  client.on("message", (message: Message) =>
    safely("message", async () => {
      const e = await toEvent(message);
      if (e) await hooks.onMessage(e);
    })
  );

  const handle: BotHandle = {
    async stop(unlink) {
      if (unlink) {
        try {
          await client.logout();
        } catch (error) {
          logger.error(`[bot] logout failed for ${companyId}`, error);
        }
      }
      try {
        await client.destroy();
      } catch (error) {
        logger.error(`[bot] destroy failed for ${companyId}`, error);
      }
    },
  };

  try {
    await client.initialize();
  } catch (error) {
    await handle.stop(false);
    throw error;
  }
  return handle;
}
