import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { createTicket } from "@/lib/tickets/service";
import { saveTicket } from "@/lib/tickets/update";
import { statusChange } from "@/lib/tickets/status";
import { runAutoClose } from "@/lib/jobs/auto-close";
import { runSlaAlerts } from "@/lib/jobs/sla-alerts";

const A = "it-2b-jobs";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);
const DAY = 86_400_000;

async function answeredTicket(daysAgo: number, customerEmail = "") {
  const t = await createTicket({ text: "x", customerContact: customerEmail });
  const at = new Date(Date.now() - daysAgo * DAY);
  return saveTicket(t, statusChange(t, "answered", at), { now: at });
}

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "Acme", slug: A } });
  await asA(() => prisma.settings.create({ data: { autoCloseDays: 3 } }));
  await asA(() =>
    prisma.admin.create({ data: { id: "it-2b-jobs-boss", username: "it-2b-jobs-boss", password: "x", role: "admin", email: "boss@acme.test" } })
  );
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
});

describe("auto-close", () => {
  it("closes answered tickets after the set days and leaves a note", async () => {
    const old = await asA(() => answeredTicket(4));
    const fresh = await asA(() => answeredTicket(1));
    await asA(() => runAutoClose(new Date()));
    const [a, b] = await asA(() => Promise.all([old, fresh].map((t) => prisma.ticket.findUniqueOrThrow({ where: { id: t.id } }))));
    expect(a.status).toBe("closed");
    expect(b.status).toBe("answered");
    const notes = await asA(() => prisma.internalNote.findMany({ where: { conversationId: a.conversationId! } }));
    expect(notes[0].content).toContain("3 days");
  });

  it("warns the client a day before when we have their email", async () => {
    const t = await asA(() => answeredTicket(2.5, "client@shop.test"));
    await asA(() => runAutoClose(new Date()));
    const emails = await asA(() => prisma.emailOutbox.findMany({ where: { ticketId: t.id, kind: "close_warning" } }));
    expect(emails.map((e) => e.to)).toEqual(["client@shop.test"]);
    const after = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: t.id } }));
    expect(after.closeWarnedAt).not.toBeNull();
    await asA(() => runAutoClose(new Date()));
    expect(await asA(() => prisma.emailOutbox.count({ where: { ticketId: t.id, kind: "close_warning" } }))).toBe(1);
  });

  it("sends no warning when the only contact we have is a phone number", async () => {
    const t = await asA(() => answeredTicket(2.5, "+15551234567"));
    await asA(() => runAutoClose(new Date()));
    expect(await asA(() => prisma.emailOutbox.count({ where: { ticketId: t.id, kind: "close_warning" } }))).toBe(0);
  });

  it("does nothing when the company closes tickets by hand", async () => {
    await asA(() => prisma.settings.updateMany({ data: { autoCloseDays: 0 } }));
    try {
      const t = await asA(() => answeredTicket(10));
      await asA(() => runAutoClose(new Date()));
      expect((await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: t.id } }))).status).toBe("answered");
    } finally {
      await asA(() => prisma.settings.updateMany({ data: { autoCloseDays: 3 } }));
    }
  });
});

describe("sla alerts", () => {
  it("emails once when a ticket goes overdue", async () => {
    await asA(() => prisma.sLARule.create({ data: { name: "fast", firstResponseMins: 1, resolutionMins: 2 } }));
    const t = await asA(() => createTicket({ text: "x" }));
    const later = new Date(Date.now() + 10 * 60_000);
    await asA(() => runSlaAlerts(later));
    await asA(() => runSlaAlerts(later));
    const emails = await asA(() => prisma.emailOutbox.findMany({ where: { ticketId: t.id, kind: "sla_breach" } }));
    expect(emails.map((e) => e.to)).toEqual(["boss@acme.test"]);
    expect((await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: t.id } }))).slaBreachedAt).not.toBeNull();
  });
});
