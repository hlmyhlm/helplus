import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BotHooks } from "@/lib/bot/client";

const row = { status: "off", unlink: false, qr: null as string | null, phone: "" };
vi.mock("@/lib/bot/state", () => ({
  readBot: vi.fn(async () => ({ ...row, seenAt: null, error: "" })),
  setBot: vi.fn(async (from: string[], to: string, patch: Record<string, unknown> = {}) => {
    if (!from.includes(row.status)) return false;
    Object.assign(row, patch, { status: to });
    return true;
  }),
  heartbeat: vi.fn(),
}));

let hooks: BotHooks;
const stop = vi.fn();
const startClient = vi.fn(async (_id: string, h: BotHooks) => {
  hooks = h;
  return { stop };
});
vi.mock("@/lib/bot/client", () => ({ startClient: (id: string, h: BotHooks) => startClient(id, h) }));
vi.mock("@/lib/bot/record", () => ({ recordInbound: vi.fn() }));
vi.mock("@/lib/notify/bot", () => ({ emailBotDown: vi.fn().mockResolvedValue(1) }));

import { prisma } from "@/lib/prisma";
import { emailBotDown } from "@/lib/notify/bot";
import { recordInbound } from "@/lib/bot/record";
import { heartbeat } from "@/lib/bot/state";
import { syncBots, stopAllBots } from "@/lib/bot/runtime";

const now = new Date("2026-10-07T10:00:00Z");

beforeEach(async () => {
  await stopAllBots();
  Object.assign(row, { status: "off", unlink: false, qr: null, phone: "" });
  vi.mocked(prisma.company.findMany).mockResolvedValue([{ id: "co-a" }] as never);
  startClient.mockClear();
  stop.mockReset();
  vi.mocked(emailBotDown).mockClear();
  vi.mocked(heartbeat).mockClear();
});

async function running() {
  row.status = "starting";
  await syncBots(now);
  await hooks.onQr("data:qr");
  await hooks.onReady("60111");
}

describe("syncBots", () => {
  it("starts a client for a starting row and follows its events", async () => {
    await running();
    expect(startClient).toHaveBeenCalledTimes(1);
    expect(startClient.mock.calls[0][0]).toBe("co-a");
    expect(row).toMatchObject({ status: "connected", phone: "60111", qr: null });
    await hooks.onMessage({ text: "hi" } as never);
    expect(recordInbound).toHaveBeenCalledWith({ text: "hi" }, "60111");
    await syncBots(now);
    expect(startClient).toHaveBeenCalledTimes(1);
    expect(heartbeat).toHaveBeenCalledWith(now);
  });

  it("restarts a connected row after a worker restart", async () => {
    row.status = "connected";
    await syncBots(now);
    expect(startClient).toHaveBeenCalledTimes(1);
  });

  it("a disconnect marks the row and emails once", async () => {
    await running();
    await hooks.onDown("NAVIGATION");
    expect(row.status).toBe("disconnected");
    expect(emailBotDown).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith(false);
  });

  it("a user stop sends no email, even if the client reports a logout", async () => {
    await running();
    row.status = "stopping";
    row.unlink = true;
    stop.mockImplementation(() => hooks.onDown("LOGOUT"));
    await syncBots(now);
    expect(stop).toHaveBeenCalledWith(true);
    expect(row).toMatchObject({ status: "off", unlink: false });
    expect(emailBotDown).not.toHaveBeenCalled();
  });

  it("a failed start marks it disconnected and emails", async () => {
    startClient.mockRejectedValueOnce(new Error("no browser"));
    row.status = "starting";
    await syncBots(now);
    expect(row.status).toBe("disconnected");
    expect(emailBotDown).toHaveBeenCalledTimes(1);
  });

  it("a qr while marked connected means the session was lost", async () => {
    await running();
    await hooks.onQr("data:qr2");
    expect(row.status).toBe("disconnected");
    expect(emailBotDown).toHaveBeenCalledTimes(1);
  });

  it("stopAllBots closes clients without logging out or touching the row", async () => {
    await running();
    await stopAllBots();
    expect(stop).toHaveBeenCalledWith(false);
    expect(row.status).toBe("connected");
  });
});
