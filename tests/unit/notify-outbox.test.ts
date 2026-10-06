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
});

describe("drainOutbox", () => {
  it("marks sent emails", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await drainOutbox(now, send)).toEqual({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledWith({ to: "a@x.com", subject: "s", text: "b" });
    expect(outbox.update.mock.calls[0][0].data).toMatchObject({ status: "sent", sentAt: now });
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

  it("gives up after the last attempt", async () => {
    outbox.findMany.mockResolvedValue([{ ...row, attempts: MAX_ATTEMPTS - 1 }]);
    const send = vi.fn().mockRejectedValue(new Error("smtp down"));
    expect(await drainOutbox(now, send)).toEqual({ sent: 0, failed: 1 });
    expect(outbox.update.mock.calls[0][0].data).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
  });
});

describe("nextAttemptAt", () => {
  it("waits 2, 4, 8, 16 minutes", () => {
    expect(nextAttemptAt(1, now).getTime() - now.getTime()).toBe(2 * 60_000);
    expect(nextAttemptAt(4, now).getTime() - now.getTime()).toBe(16 * 60_000);
  });
});
