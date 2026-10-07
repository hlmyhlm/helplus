import { prisma } from "@/lib/prisma";
import { channelKey } from "@/lib/tenant/keys";

export type BotStatus = "off" | "starting" | "qr" | "connected" | "disconnected" | "stopping";

export interface BotState {
  status: BotStatus;
  qr: string | null;
  seenAt: Date | null;
  phone: string;
  error: string;
  unlink: boolean;
}

// a type, not an interface, so prisma accepts it as json
type Config = {
  qr?: string | null;
  qrAt?: string;
  seenAt?: string;
  phone?: string;
  error?: string;
  unlink?: boolean;
};

type Patch = Partial<{ qr: string | null; phone: string; error: string; unlink: boolean }>;

export const STALE_MS = 3 * 60_000;

const STATUSES: BotStatus[] = ["off", "starting", "qr", "connected", "disconnected", "stopping"];

// old rows can say "error" or anything else, which means not running
function statusOf(raw: string | undefined): BotStatus {
  return STATUSES.includes(raw as BotStatus) ? (raw as BotStatus) : "off";
}

function load() {
  return prisma.channel.findUnique({ where: channelKey("whatsapp") });
}

export async function readBot(): Promise<BotState> {
  const row = await load();
  const config = (row?.config ?? {}) as Config;
  return {
    status: statusOf(row?.status),
    qr: config.qr ?? null,
    seenAt: config.seenAt ? new Date(config.seenAt) : null,
    phone: config.phone ?? "",
    error: config.error ?? "",
    unlink: !!config.unlink,
  };
}

// web and worker both write here, so merge config and only move from a status we expect
export async function setBot(from: BotStatus[], to: BotStatus, patch: Patch = {}): Promise<boolean> {
  const row = await load();
  if (!from.includes(statusOf(row?.status))) return false;
  const config: Config = { ...((row?.config as Config) ?? {}), ...patch };
  if (typeof patch.qr === "string") config.qrAt = new Date().toISOString();
  if (!row) {
    try {
      await prisma.channel.create({ data: { type: "whatsapp", status: to, isActive: to === "connected", config } });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") return false;
      throw error;
    }
  }
  const { count } = await prisma.channel.updateMany({
    where: { id: row.id, status: row.status, updatedAt: row.updatedAt },
    data: { status: to, isActive: to === "connected", config },
  });
  return count === 1;
}

export function requestStart(): Promise<boolean> {
  return setBot(["off", "disconnected"], "starting", { qr: null, error: "", unlink: false });
}

export function requestStop(unlink: boolean): Promise<boolean> {
  return setBot(["starting", "qr", "connected"], "stopping", { unlink });
}

export async function heartbeat(now: Date): Promise<void> {
  const row = await load();
  if (!row || row.status !== "connected") return;
  const config: Config = { ...((row.config as Config) ?? {}), seenAt: now.toISOString() };
  await prisma.channel.updateMany({
    where: { id: row.id, status: "connected", updatedAt: row.updatedAt },
    data: { config },
  });
}
