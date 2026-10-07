import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { runOriginalRetention, runPendingAttachments } from "@/lib/jobs/attachments";

vi.mock("@/lib/attachments/process", () => ({ processAttachment: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSettings: vi.fn(async () => ({ originalRetentionDays: 90 })) }));

const attachment = (prisma as unknown as { attachment: Record<string, ReturnType<typeof vi.fn>> }).attachment;

beforeEach(() => {
  attachment.findMany.mockReset().mockResolvedValue([]);
});

describe("attachment jobs", () => {
  it("retries the oldest stuck screenshots that still have an original, five at a time", async () => {
    await runPendingAttachments(new Date());
    const args = attachment.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ status: "pending", originalKey: { not: null } });
    expect(args.orderBy).toEqual({ createdAt: "asc" });
    expect(args.take).toBe(5);
  });

  it("deletes the longest-closed originals first", async () => {
    await runOriginalRetention(new Date());
    expect(attachment.findMany.mock.calls[0][0].orderBy).toEqual({ ticket: { closedAt: "asc" } });
  });
});
