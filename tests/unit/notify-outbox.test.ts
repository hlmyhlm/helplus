import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { drainOutbox, nextAttemptAt, MAX_ATTEMPTS } from "@/lib/notify/outbox";

const outbox = (prisma as unknown as { emailOutbox: Record<string, ReturnType<typeof vi.fn>> }).emailOutbox;
const now = new Date("2026-10-08T00:00:00Z");
const row = { id: "e1", to: "a@x.com", subject: "s", body: "b", attempts: 0 };

beforeEach(() => {
  for (const fn of Object.values(outbox)) fn.mockReset();
  outbox.findMany.mockResolvedValue([row]);
  outbox.update.mockResolvedValue({});
  outbox.updateMany.mockResolvedValue({ count: 1 });
});

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
    // call 0 is the stuck-row recovery sweep, call 1 is the claim for this row
    expect(outbox.updateMany.mock.calls[1][0]).toEqual({
      where: { id: "e1", status: "pending" },
      data: { status: "sending" },
    });
  });

  it("resets a stuck sending row older than 10 minutes", async () => {
    outbox.findMany.mockResolvedValue([]);
    await drainOutbox(now);
    expect(outbox.updateMany.mock.calls[0][0]).toEqual({
      where: { status: "sending", nextAttemptAt: { lte: new Date(now.getTime() - 10 * 60_000) } },
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
