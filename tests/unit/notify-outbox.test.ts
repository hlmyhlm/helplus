import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { drainOutbox, nextAttemptAt, MAX_ATTEMPTS, STUCK_MINS } from "@/lib/notify/outbox";

const outbox = (prisma as unknown as { emailOutbox: Record<string, ReturnType<typeof vi.fn>> }).emailOutbox;
const now = new Date("2026-10-08T00:00:00Z");
const row = { id: "e1", to: "a@x.com", subject: "s", body: "b", attempts: 0 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  for (const fn of Object.values(outbox)) fn.mockReset();
  outbox.findMany.mockResolvedValue([row]);
  outbox.update.mockResolvedValue({});
  outbox.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

const fiveMinLater = new Date(now.getTime() + 5 * 60_000);

describe("drainOutbox", () => {
  it("marks sent emails", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await drainOutbox(now, send)).toEqual({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledWith({ to: "a@x.com", subject: "s", text: "b" });
    expect(outbox.update.mock.calls[0][0].data).toMatchObject({ status: "sent", sentAt: now });
  });

  it("claims a row before sending it", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await drainOutbox(now, send);
    // call 0 is the stuck-row sweep
    expect(outbox.updateMany.mock.calls[1][0]).toEqual({
      where: { id: "e1", status: "pending" },
      data: { status: "sending", nextAttemptAt: now },
    });
  });

  it("stamps the claim and the send with the clock, not the pass start", async () => {
    vi.setSystemTime(fiveMinLater);
    await drainOutbox(now, vi.fn().mockResolvedValue(undefined));
    expect(outbox.updateMany.mock.calls[1][0].data.nextAttemptAt).toEqual(fiveMinLater);
    expect(outbox.update.mock.calls[0][0].data.sentAt).toEqual(fiveMinLater);
  });

  it("doesn't reset a row claimed just now even though it was overdue when claimed", async () => {
    // due an hour ago, well past the stuck window
    const dbRow = {
      id: "e1",
      to: "a@x.com",
      subject: "s",
      body: "b",
      attempts: 0,
      status: "pending" as string,
      nextAttemptAt: new Date(now.getTime() - 60 * 60_000),
    };

    outbox.findMany.mockImplementation(async (args: { where: { nextAttemptAt: { lte: Date } } }) => {
      if (dbRow.status !== "pending") return [];
      if (dbRow.nextAttemptAt.getTime() > args.where.nextAttemptAt.lte.getTime()) return [];
      return [{ ...dbRow }];
    });

    outbox.updateMany.mockImplementation(
      async (args: { where: { id?: string; status: string; nextAttemptAt?: { lte: Date } }; data: { status: string; nextAttemptAt?: Date } }) => {
        if (args.where.status === "sending") {
          // stuck-row sweep
          if (dbRow.status === "sending" && dbRow.nextAttemptAt.getTime() <= args.where.nextAttemptAt!.lte.getTime()) {
            dbRow.status = "pending";
            return { count: 1 };
          }
          return { count: 0 };
        }
        // the claim
        if (args.where.id === dbRow.id && dbRow.status === "pending") {
          dbRow.status = args.data.status;
          if (args.data.nextAttemptAt) dbRow.nextAttemptAt = args.data.nextAttemptAt;
          return { count: 1 };
        }
        return { count: 0 };
      }
    );

    // first send hangs, still in flight on the next pass
    let sendCalls = 0;
    const send = vi.fn(() => {
      sendCalls++;
      return sendCalls === 1 ? new Promise<void>(() => {}) : Promise.resolve();
    });

    void drainOutbox(now, send);
    await vi.waitFor(() => {
      if (dbRow.status !== "sending") throw new Error("not claimed yet");
    });

    const oneMinuteLater = new Date(now.getTime() + 60_000);
    vi.setSystemTime(oneMinuteLater);
    await drainOutbox(oneMinuteLater, send);

    // a second send means the sweep reset a row still in flight
    expect(sendCalls).toBe(1);
  });

  it("resets a stuck sending row older than 10 minutes", async () => {
    outbox.findMany.mockResolvedValue([]);
    await drainOutbox(now);
    expect(outbox.updateMany.mock.calls[0][0]).toEqual({
      where: { status: "sending", nextAttemptAt: { lte: new Date(now.getTime() - STUCK_MINS * 60_000) } },
      data: { status: "pending" },
    });
  });

  it("skips a row that fails to claim", async () => {
    const other = { ...row, id: "e2" };
    outbox.findMany.mockResolvedValue([row, other]);
    outbox.updateMany.mockImplementation(async (args: { where: { id?: string; status: string } }) => {
      if (args.where.id === "e1") return { count: 0 };
      return { count: 1 };
    });
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await drainOutbox(now, send)).toEqual({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: other.to }));
  });

  it("processes every row in a batch even if one throws", async () => {
    const other = { ...row, id: "e2" };
    outbox.findMany.mockResolvedValue([row, other]);
    const send = vi.fn().mockRejectedValueOnce(new Error("smtp down")).mockResolvedValueOnce(undefined);
    expect(await drainOutbox(now, send)).toEqual({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    const calls = outbox.update.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ where: { id: "e1" }, data: expect.objectContaining({ status: "pending", attempts: 1 }) });
    expect(calls).toContainEqual({ where: { id: "e2" }, data: expect.objectContaining({ status: "sent" }) });
  });

  it("doesn't count a mark-sent failure as a failed attempt", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    outbox.update.mockRejectedValue(new Error("db hiccup"));
    expect(await drainOutbox(now, send)).toEqual({ sent: 0, failed: 0 });
    expect(outbox.update).toHaveBeenCalledTimes(1);
    expect(outbox.update.mock.calls[0][0].data).not.toHaveProperty("attempts");
  });

  it("retries later on failure", async () => {
    const send = vi.fn().mockRejectedValue(new Error("smtp down"));
    await drainOutbox(now, send);
    expect(outbox.update.mock.calls[0][0].data).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "smtp down",
      nextAttemptAt: nextAttemptAt(1, now),
    });
  });

  it("gives up after the last attempt and doesn't set nextAttemptAt", async () => {
    outbox.findMany.mockResolvedValue([{ ...row, attempts: MAX_ATTEMPTS - 1 }]);
    const send = vi.fn().mockRejectedValue(new Error("smtp down"));
    expect(await drainOutbox(now, send)).toEqual({ sent: 0, failed: 1 });
    expect(outbox.update.mock.calls[0][0].data).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(outbox.update.mock.calls[0][0].data).not.toHaveProperty("nextAttemptAt");
  });
});

describe("nextAttemptAt", () => {
  it("waits 2, 4, 8, 16 minutes", () => {
    expect(nextAttemptAt(1, now).getTime() - now.getTime()).toBe(2 * 60_000);
    expect(nextAttemptAt(4, now).getTime() - now.getTime()).toBe(16 * 60_000);
  });
});
