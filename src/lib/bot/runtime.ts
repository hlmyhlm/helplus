import { rm } from "node:fs/promises";
import { join } from "node:path";
import { systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { logger } from "@/lib/logger";
import { emailBotDown } from "@/lib/notify/bot";
import { recordInbound } from "./record";
import { startClient, type BotHandle } from "./client";
import { readBot, setBot, heartbeat } from "./state";

const BEAT_MS = 15_000;
const DOWN = "WhatsApp disconnected. Connect again from Sources.";

interface Running {
  handle: BotHandle | null;
  ready: boolean;
  phone: string;
  beatAt: number;
  // set once we stop it ourselves, so its last events are ignored
  closing: boolean;
}

const bots = new Map<string, Running>();

function sessionDir(companyId: string): string {
  return join(".wwebjs_auth", companyId === "default" ? "session" : `session-${companyId}`);
}

async function close(companyId: string, entry: Running, unlink: boolean) {
  entry.closing = true;
  if (bots.get(companyId) === entry) bots.delete(companyId);
  await entry.handle?.stop(unlink);
}

async function lost(companyId: string, entry: Running, reason: string) {
  if (entry.closing) return;
  logger.info(`[bot] ${companyId} went down: ${reason}`);
  void close(companyId, entry, false);
  if (await setBot(["connected", "qr", "starting"], "disconnected", { qr: null, error: DOWN })) await emailBotDown();
}

async function start(companyId: string) {
  const entry: Running = { handle: null, ready: false, phone: "", beatAt: 0, closing: false };
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
    logger.error(`[bot] couldn't start whatsapp for ${companyId}`, error);
    entry.closing = true;
    if (bots.get(companyId) === entry) bots.delete(companyId);
    if (await setBot(["starting", "qr", "connected"], "disconnected", { qr: null, error: "Couldn't start WhatsApp" })) {
      await emailBotDown();
    }
    return;
  }
  // it went down while starting
  if (entry.closing) await entry.handle.stop(false);
}

async function syncOne(companyId: string, now: Date) {
  const state = await readBot();
  const entry = bots.get(companyId);

  if (state.status === "stopping") {
    if (entry) await close(companyId, entry, state.unlink);
    else if (state.unlink) await rm(sessionDir(companyId), { recursive: true, force: true }).catch(() => {});
    await setBot(["stopping"], "off", { qr: null, unlink: false, error: "" });
    return;
  }
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
  await Promise.all(all.map(([id, entry]) => close(id, entry, false)));
}
