import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { setBot } from "@/lib/bot/state";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const row = (status: string, at: number) => ({ id: "ch1", status, config: {}, updatedAt: new Date(at) });

beforeEach(() => {
  for (const fn of Object.values(db.channel)) fn.mockReset();
});

describe("setBot", () => {
  it("tries again once when a heartbeat changed the row first", async () => {
    db.channel.findUnique.mockResolvedValueOnce(row("connected", 1)).mockResolvedValueOnce(row("connected", 2));
    db.channel.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    expect(await runWithCompany("co-a", () => setBot(["connected"], "disconnected"))).toBe(true);
    expect(db.channel.updateMany).toHaveBeenCalledTimes(2);
    expect(db.channel.updateMany.mock.calls[1][0].where.updatedAt).toEqual(new Date(2));
  });

  it("doesn't retry when the status moved on", async () => {
    db.channel.findUnique.mockResolvedValueOnce(row("connected", 1)).mockResolvedValueOnce(row("stopping", 2));
    db.channel.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await runWithCompany("co-a", () => setBot(["connected"], "disconnected"))).toBe(false);
    expect(db.channel.updateMany).toHaveBeenCalledTimes(1);
  });

  it("gives up after the second miss", async () => {
    db.channel.findUnique.mockResolvedValue(row("connected", 1));
    db.channel.updateMany.mockResolvedValue({ count: 0 });
    expect(await runWithCompany("co-a", () => setBot(["connected"], "disconnected"))).toBe(false);
    expect(db.channel.updateMany).toHaveBeenCalledTimes(2);
  });
});
