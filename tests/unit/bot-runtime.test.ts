import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BotHooks } from "@/lib/bot/client";

const row = { status: "off", unlink: false, qr: null as string | null, phone: "", error: "" };
vi.mock("@/lib/bot/state", () => ({
  readBot: vi.fn(async () => ({ ...row, seenAt: null })),
  setBot: vi.fn(async (from: string[], to: string, patch: Record<string, unknown> = {}) => {
    if (!from.includes(row.status)) return false;
    Object.assign(row, patch, { status: to });
    return true;
  }),
  heartbeat: vi.fn(),
}));

let hooks: BotHooks;
let settle: { resolve: () => void; reject: (e: unknown) => void };
const stop = vi.fn();
const startClient = vi.fn(async (_id: string, h: BotHooks) => {
  hooks = h;
  const started = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  return { stop, started };
});
vi.mock("@/lib/bot/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/bot/client")>();
  return {
    QR_EXPIRED: real.QR_EXPIRED,
    StartTimeoutError: real.StartTimeoutError,
    startClient: (id: string, h: BotHooks) => startClient(id, h),
  };
});
vi.mock("@/lib/bot/record", () => ({ recordInbound: vi.fn() }));
vi.mock("@/lib/notify/bot", () => ({ emailBotDown: vi.fn().mockResolvedValue(1) }));
vi.mock("node:fs/promises", () => ({ rm: vi.fn().mockResolvedValue(undefined) }));

import { rm } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { emailBotDown } from "@/lib/notify/bot";
import { recordInbound } from "@/lib/bot/record";
import { heartbeat } from "@/lib/bot/state";
import { StartTimeoutError, QR_EXPIRED } from "@/lib/bot/client";
import { syncBots, stopAllBots } from "@/lib/bot/runtime";

const now = new Date("2026-10-07T10:00:00Z");
const company = (id: string) => vi.mocked(prisma.company.findMany).mockResolvedValue([{ id }] as never);

beforeEach(async () => {
  stop.mockReset().mockResolvedValue(undefined);
  await stopAllBots();
  Object.assign(row, { status: "off", unlink: false, qr: null, phone: "", error: "" });
  company("co-a");
  startClient.mockClear();
  stop.mockClear();
  vi.mocked(emailBotDown).mockClear();
  vi.mocked(heartbeat).mockClear();
  vi.mocked(rm).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

async function running() {
  row.status = "starting";
  await syncBots(now);
  settle.resolve();
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

  it("doesn't wait for chromium and skips the company while it starts", async () => {
    row.status = "starting";
    await syncBots(now);
    await syncBots(now);
    expect(startClient).toHaveBeenCalledTimes(1);
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it("a stop during a start closes the client right away", async () => {
    row.status = "starting";
    await syncBots(now);
    row.status = "stopping";
    await syncBots(now);
    expect(stop).toHaveBeenCalledWith(false);
    expect(row.status).toBe("off");
    settle.reject(new Error("browser closed"));
    await Promise.resolve();
    expect(row.status).toBe("off");
    expect(emailBotDown).not.toHaveBeenCalled();
  });

  it("restarts a connected row after a worker restart", async () => {
    row.status = "connected";
    await syncBots(now);
    expect(startClient).toHaveBeenCalledTimes(1);
  });

  it("a disconnect marks the row and emails once", async () => {
    await running();
    await hooks.onDown("NAVIGATION");
    await hooks.onDown("BROWSER_CLOSED");
    expect(row.status).toBe("disconnected");
    expect(emailBotDown).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith(false);
  });

  it("a user unlink sends no email, even if the client reports a logout, and removes the session", async () => {
    await running();
    row.status = "stopping";
    row.unlink = true;
    stop.mockImplementation(() => hooks.onDown("LOGOUT"));
    await syncBots(now);
    expect(stop).toHaveBeenCalledWith(true);
    expect(row).toMatchObject({ status: "off", unlink: false });
    expect(emailBotDown).not.toHaveBeenCalled();
    expect(vi.mocked(rm).mock.calls[0][0]).toMatch(/[\\/]session-co-a$/);
  });

  it("removes the default session folder, but never one with an odd company id", async () => {
    company("default");
    Object.assign(row, { status: "stopping", unlink: true });
    await syncBots(now);
    expect(vi.mocked(rm).mock.calls[0][0]).toMatch(/[\\/]session$/);
    company("../x");
    Object.assign(row, { status: "stopping", unlink: true });
    await syncBots(now);
    expect(rm).toHaveBeenCalledTimes(1);
    expect(row.status).toBe("off");
  });

  it("a failed start marks it disconnected and emails", async () => {
    row.status = "starting";
    await syncBots(now);
    settle.reject(new Error("no browser"));
    await vi.waitFor(() => expect(row.status).toBe("disconnected"));
    expect(row.error).toBe("Couldn't start WhatsApp");
    expect(emailBotDown).toHaveBeenCalledTimes(1);
  });

  it("a start that times out says so", async () => {
    row.status = "starting";
    await syncBots(now);
    settle.reject(new StartTimeoutError());
    await vi.waitFor(() => expect(row.error).toBe("WhatsApp took too long to start"));
    expect(row.status).toBe("disconnected");
    expect(emailBotDown).toHaveBeenCalledTimes(1);
  });

  it("an expired qr turns it off without an email", async () => {
    row.status = "starting";
    await syncBots(now);
    settle.resolve();
    await hooks.onQr("data:qr");
    await hooks.onDown(QR_EXPIRED);
    await hooks.onDown("BROWSER_CLOSED");
    expect(row).toMatchObject({ status: "off", error: "QR code expired. Connect again.", qr: null });
    expect(emailBotDown).not.toHaveBeenCalled();
  });

  it("a qr while marked connected means the session was lost", async () => {
    await running();
    await hooks.onQr("data:qr2");
    expect(row.status).toBe("disconnected");
    expect(emailBotDown).toHaveBeenCalledTimes(1);
  });
});

describe("stopAllBots", () => {
  it("closes clients without logging out or touching the row", async () => {
    await running();
    await stopAllBots();
    expect(stop).toHaveBeenCalledWith(false);
    expect(row.status).toBe("connected");
  });

  it("doesn't wait forever on a hung client", async () => {
    await running();
    vi.useFakeTimers();
    stop.mockReturnValue(new Promise(() => {}));
    let done = false;
    void stopAllBots().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toBe(true);
  });
});
