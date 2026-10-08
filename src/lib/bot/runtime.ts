import { rm } from "node:fs/promises";
import { join } from "node:path";
import { systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { logger } from "@/lib/logger";
import { emailBotDown } from "@/lib/notify/bot";
import { recordInbound } from "./record";
import { startClient, QR_EXPIRED, StartTimeoutError, type BotHandle } from "./client";
import { readBot, setBot, heartbeat } from "./state";

const BEAT_MS = 15_000;
const SHUTDOWN_MS = 10_000;
const DOWN = "WhatsApp disconnected. Connect again from Sources.";

interface Running {
  handle: BotHandle | null;
  // set until the client has finished starting
  pending: boolean;
  ready: boolean;
  phone: string;
  beatAt: number;
  // set once we stop it ourselves, so its last events are ignored
  closing: boolean;
}

const bots = new Map<string, Running>();
// a stopped client whose start hasn't settled yet still holds the session folder
const draining = new Map<string, Promise<void>>();

async function removeSession(companyId: string) {
  if (!/^[-_\w]+$/.test(companyId)) return;
  const dir = join(".wwebjs_auth", companyId === "default" ? "session" : `session-${companyId}`);
  await rm(dir, { recursive: true, force: true, maxRetries: 4 }).catch((error) => logger.error(`[bot] couldn't remove ${dir}`, error));
}

function close(companyId: string, entry: Running, unlink: boolean): Promise<void> {
  entry.closing = true;
  if (bots.get(companyId) === entry) bots.delete(companyId);
  const handle = entry.handle;
  if (!handle || !entry.pending) {
    return (async () => {
      await handle?.stop(unlink);
      if (unlink) await removeSession(companyId);
    })();
  }
  // still starting: a new start waits for this one to settle
  const drain = (async () => {
    if (!unlink) await handle.stop(false);
    await handle.started.catch(() => {});
    // logout needs the page, so an unlink waits for the start to finish
    if (unlink) {
      await handle.stop(true);
      await removeSession(companyId);
    }
  })()
    .catch((error) => logger.error(`[bot] couldn't close whatsapp for ${companyId}`, error))
    .finally(() => {
      if (draining.get(companyId) === drain) draining.delete(companyId);
    });
  draining.set(companyId, drain);
  return drain;
}

async function lost(companyId: string, entry: Running, reason: string) {
  if (entry.closing) return;
  logger.info(`[bot] ${companyId} went down: ${reason}`);
  void close(companyId, entry, false);
  if (reason === QR_EXPIRED) {
    await setBot(["starting", "qr"], "off", { qr: null, error: "QR code expired. Connect again." });
    return;
  }
  if (await setBot(["connected", "qr", "starting"], "disconnected", { qr: null, error: DOWN })) await emailBotDown();
}

async function failed(companyId: string, entry: Running, error: unknown) {
  if (entry.closing) return;
  logger.error(`[bot] couldn't start whatsapp for ${companyId}`, error);
  entry.closing = true;
  if (bots.get(companyId) === entry) bots.delete(companyId);
  const message = error instanceof StartTimeoutError ? "WhatsApp took too long to start" : "Couldn't start WhatsApp";
  if (await setBot(["starting", "qr", "connected"], "disconnected", { qr: null, error: message })) await emailBotDown();
}

async function start(companyId: string) {
  const entry: Running = { handle: null, pending: true, ready: false, phone: "", beatAt: 0, closing: false };
  const as = (fn: () => Promise<void>) => runWithCompany(companyId, fn);
  bots.set(companyId, entry);
  try {
    entry.handle = await startClient(companyId, {
      onQr: (qr) =>
        as(async () => {
          if (entry.closing || (await setBot(["starting", "qr"], "qr", { qr }))) return;
          // a qr while marked connected means the saved session is gone
          if (await setBot(["connected"], "disconnected", { qr: null, error: DOWN })) {
            void close(companyId, entry, false);
            await emailBotDown();
          }
        }),
      onReady: (phone) =>
        as(async () => {
          if (entry.closing) return;
          entry.ready = true;
          entry.phone = phone;
          await setBot(["starting", "qr", "connected"], "connected", { qr: null, phone, error: "" });
        }),
      onDown: (reason) => as(() => lost(companyId, entry, reason)),
      onMessage: (e) =>
        as(async () => {
          if (!entry.closing) await recordInbound(e, entry.phone);
        }),
    });
  } catch (error) {
    entry.pending = false;
    await failed(companyId, entry, error);
    return;
  }
  // don't hold up the sync while chromium starts
  void entry.handle.started.then(
    () => {
      entry.pending = false;
    },
    (error) => {
      entry.pending = false;
      return as(() => failed(companyId, entry, error));
    }
  );
}

async function syncOne(companyId: string, now: Date) {
  const state = await readBot();
  const entry = bots.get(companyId);

  if (state.status === "stopping") {
    if (entry?.pending) void close(companyId, entry, state.unlink);
    else if (entry) await close(companyId, entry, state.unlink);
    else if (state.unlink) await removeSession(companyId);
    await setBot(["stopping"], "off", { qr: null, unlink: false, error: "" });
    return;
  }
  if (draining.has(companyId)) return;
  if (entry?.pending) return;
  if (state.status === "off" || state.status === "disconnected") {
    if (entry) await close(companyId, entry, false);
    return;
  }
  if (!entry) {
    await start(companyId);
    return;
  }
  if (state.status === "connected" && entry.ready && now.getTime() - entry.beatAt >= BEAT_MS) {
    entry.beatAt = now.getTime();
    await heartbeat(now);
  }
}

export async function syncBots(now: Date): Promise<void> {
  const companies = await systemPrisma.company.findMany({ select: { id: true } });
  for (const { id } of companies) {
    try {
      await runWithCompany(id, () => syncOne(id, now));
    } catch (error) {
      logger.error(`[bot] sync failed for ${id}`, error);
    }
  }
}

// worker shutdown: close the browsers but keep the sessions and the row status
export async function stopAllBots(): Promise<void> {
  const all = [...bots.entries()];
  const closing = Promise.all(all.map(([id, entry]) => close(id, entry, false)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SHUTDOWN_MS);
  });
  await Promise.race([closing, giveUp]);
  clearTimeout(timer);
}
