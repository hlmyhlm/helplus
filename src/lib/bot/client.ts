import { Client, LocalAuth, type Message } from "whatsapp-web.js";
import * as qrcode from "qrcode";
import { logger } from "@/lib/logger";
import { MAX_BYTES } from "@/lib/attachments/client";
import type { IncomingEvent } from "./record";
import { isStoredImage } from "./rules";

// the only file that touches whatsapp-web.js, and it only listens
export interface BotHandle {
  stop(unlink: boolean): Promise<void>;
  started: Promise<void>;
}

export interface BotHooks {
  onQr(dataUrl: string): Promise<void>;
  onReady(phone: string): Promise<void>;
  onDown(reason: string): Promise<void>;
  onMessage(e: IncomingEvent): Promise<void>;
}

export const START_TIMEOUT_MS = 90_000;
export const QR_RETRIES = 5;
// whatsapp-web.js sends this reason when nobody scans in time
export const QR_EXPIRED = "Max qrcode retries reached";
export const BROWSER_CLOSED = "BROWSER_CLOSED";

export class StartTimeoutError extends Error {
  constructor() {
    super("whatsapp took too long to start");
    this.name = "StartTimeoutError";
  }
}

// these never become tickets
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
  "poll_creation",
  "groups_v4_invite",
  "product",
  "order",
  "list",
  "buttons_response",
  "payment",
  "unknown",
]);

// these bodies can hold a base64 thumbnail or raw vcard
const PLACEHOLDER: Record<string, string> = {
  location: "[location]",
  vcard: "[contact card]",
  multi_vcard: "[contact card]",
};

// used when the message doesn't say its mime type
const MIME_BY_TYPE: Record<string, string> = {
  image: "image/jpeg",
  ptt: "audio/ogg; codecs=opus",
  audio: "audio/mpeg",
  video: "video/mp4",
};

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

async function quotedId(message: Message): Promise<string | null> {
  if (!message.hasQuotedMsg) return null;
  try {
    return (await message.getQuotedMessage())?.id?._serialized ?? null;
  } catch {
    return null;
  }
}

async function image(message: Message): Promise<IncomingEvent["media"]> {
  try {
    const media = await message.downloadMedia();
    const data = media?.data ? Buffer.from(media.data, "base64") : null;
    return data?.length ? { data, fileName: media.filename ?? "", mime: media.mimetype } : null;
  } catch {
    return null;
  }
}

// only images are downloaded; other media just needs a name and type for the note
function rawData(message: Message): { mimetype?: string; filename?: string; size?: number } {
  return (message as unknown as { _data?: { mimetype?: string; filename?: string; size?: number } })._data ?? {};
}

function described(message: Message, type: string): NonNullable<IncomingEvent["media"]> {
  const raw = rawData(message);
  return { data: Buffer.alloc(0), fileName: raw.filename ?? "", mime: raw.mimetype || MIME_BY_TYPE[type] || "application/octet-stream" };
}

// too big or an odd format gets a note instead of a download
function wantsBytes(message: Message, mime: string): boolean {
  const size = Number(rawData(message).size ?? 0);
  return isStoredImage(mime) && !(size > MAX_BYTES);
}

export async function toEvent(message: Message): Promise<IncomingEvent | null> {
  const type = String(message.type ?? "");
  if (message.fromMe || message.isStatus || message.broadcast || SKIP.has(type)) return null;
  const chat = await message.getChat();
  const chatWaId = chat.id._serialized;
  if (chatWaId === "status@broadcast") return null;
  const who = await sender(message, message.author ?? message.from);
  const placeholder = PLACEHOLDER[type];
  let text = placeholder ?? message.body ?? "";
  let media: IncomingEvent["media"] = null;
  if (message.hasMedia && !placeholder) {
    const info = described(message, type);
    // images sent as documents still need their bytes
    media = wantsBytes(message, info.mime) ? await image(message) : info;
    if (!media) text = `[media unavailable] ${text}`.trim();
  }
  return {
    waMessageId: message.id._serialized,
    chatWaId,
    chatName: chat.name ?? "",
    isGroup: chat.isGroup,
    senderId: who.id,
    senderName: who.name,
    text,
    at: new Date(message.timestamp * 1000),
    quotedWaId: await quotedId(message),
    media,
  };
}

export async function startClient(companyId: string, hooks: BotHooks, timeoutMs = START_TIMEOUT_MS): Promise<BotHandle> {
  const client = new Client({
    // default keeps the old unnamed session folder, so a linked session still works
    authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth", clientId: companyId === "default" ? undefined : companyId }),
    qrMaxRetries: QR_RETRIES,
    puppeteer: {
      headless: true,
      // the worker shuts the browsers down itself
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
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

  let stopped = false;
  async function stop(unlink: boolean) {
    stopped = true;
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
    // destroy() checks isConnected(), which puppeteer 25 removed, so it leaves chromium running
    try {
      await client.pupBrowser?.close();
    } catch {
      // already closed
    }
  }

  // a stop before chromium is up gets repeated once the start ends
  const started = new Promise<void>((resolve, fail) => {
    const timer = setTimeout(() => {
      void stop(false).finally(() => fail(new StartTimeoutError()));
    }, timeoutMs);
    client.initialize().then(
      async () => {
        clearTimeout(timer);
        if (stopped) {
          await stop(false);
          fail(new Error("stopped while starting"));
          return;
        }
        // a crashed chromium sends no whatsapp event
        client.pupBrowser?.on("disconnected", () => void safely("browser", () => hooks.onDown(BROWSER_CLOSED)));
        resolve();
      },
      async (error: unknown) => {
        clearTimeout(timer);
        await stop(false);
        fail(error);
      }
    );
  });
  // the runtime handles failures; this keeps node quiet if it never looks
  started.catch(() => {});

  return { stop, started };
}
