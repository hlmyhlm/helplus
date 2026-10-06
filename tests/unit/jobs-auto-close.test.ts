import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { saveTicket, loadSlaContext } from "@/lib/tickets/update";
import { queueEmail } from "@/lib/notify/outbox";
import { runAutoClose } from "@/lib/jobs/auto-close";

vi.mock("@/lib/settings", () => ({ getSettings: vi.fn() }));
vi.mock("@/lib/tickets/update", () => ({ saveTicket: vi.fn(), loadSlaContext: vi.fn() }));
vi.mock("@/lib/notify/outbox", () => ({ queueEmail: vi.fn() }));
vi.mock("@/lib/notify/notify", () => ({ companyName: vi.fn().mockResolvedValue("Acme") }));

const ticket = (prisma as unknown as { ticket: Record<string, ReturnType<typeof vi.fn>> }).ticket;
const internalNote = (prisma as unknown as { internalNote: Record<string, ReturnType<typeof vi.fn>> }).internalNote;
const now = new Date("2026-10-08T00:00:00Z");

beforeEach(() => {
  for (const fn of Object.values(ticket)) fn.mockReset();
  for (const fn of Object.values(internalNote)) fn.mockReset();
  vi.mocked(saveTicket).mockReset();
  vi.mocked(queueEmail).mockReset();
  vi.mocked(getSettings).mockResolvedValue({ autoCloseDays: 3 } as never);
  vi.mocked(loadSlaContext).mockResolvedValue({ rules: [], cal: {} } as never);
  ticket.findMany.mockResolvedValue([]);
  ticket.findFirst.mockResolvedValue(null);
});

describe("runAutoClose", () => {
  it("skips a ticket the client already replied to, not just the stale list", async () => {
    // the list query found it answered, but by the time we get to it the client moved it on
    ticket.findMany.mockResolvedValueOnce([{ id: "t1", status: "answered", conversationId: "c1" }]);
    ticket.findFirst.mockResolvedValueOnce(null);

    const result = await runAutoClose(now);

    expect(result.closed).toBe(0);
    expect(saveTicket).not.toHaveBeenCalled();
    expect(internalNote.create).not.toHaveBeenCalled();
  });

  it("skips a warning for a ticket already warned or moved on since the list was read", async () => {
    ticket.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "t2", conversation: { customerContact: "", customer: null } }]);
    ticket.findFirst.mockResolvedValueOnce(null);

    const result = await runAutoClose(now);

    expect(result.warned).toBe(0);
    expect(queueEmail).not.toHaveBeenCalled();
    expect(ticket.updateMany).not.toHaveBeenCalled();
  });

  it("only closes tickets warned at least a day ago", async () => {
    await runAutoClose(now);
    const where = ticket.findMany.mock.calls[0][0].where;
    expect(where.closeWarnedAt).toEqual({ lte: new Date(now.getTime() - 86_400_000) });
  });

  it("closes without a warning when set to one day", async () => {
    vi.mocked(getSettings).mockResolvedValue({ autoCloseDays: 1 } as never);
    await runAutoClose(now);
    expect(ticket.findMany.mock.calls[0][0].where.closeWarnedAt).toBeUndefined();
  });

  it("doesn't email when the ticket moved on before the stamp", async () => {
    ticket.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "t3", conversation: { customerContact: "a@b.test", customer: null } }]);
    ticket.findFirst.mockResolvedValueOnce({ id: "t3", status: "answered" });
    ticket.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await runAutoClose(now);

    expect(ticket.updateMany).toHaveBeenCalledWith({ where: { id: "t3", status: "answered", closeWarnedAt: null }, data: { closeWarnedAt: now } });
    expect(queueEmail).not.toHaveBeenCalled();
    expect(result.warned).toBe(0);
  });
});
