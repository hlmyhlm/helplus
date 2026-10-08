import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { createTicket } from "@/lib/tickets/service";
import { saveTicket } from "@/lib/tickets/update";
import { statusChange } from "@/lib/tickets/status";

const A = "it-2b-notify";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "Acme", slug: A } });
  await asA(() =>
    prisma.admin.createMany({
      data: [
        { id: "it-2b-boss", username: "it-2b-boss", password: "x", role: "admin", email: "boss@acme.test", notifyNew: true },
        { id: "it-2b-staff", username: "it-2b-staff", password: "x", role: "staff", email: "staff@acme.test", notifyNew: true },
      ],
    })
  );
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
});

describe("staff alerts", () => {
  it("queue new ticket emails only for people who can see the project", async () => {
    const t = await asA(() => createTicket({ text: "printer down" }));
    const emails = await asA(() => prisma.emailOutbox.findMany({ where: { ticketId: t.id } }));
    expect(emails.map((e) => e.to)).toEqual(["boss@acme.test"]);
    expect(emails[0].body).not.toContain("printer");
  });

  it("tell the assignee when someone else reopens", async () => {
    const t = await asA(() => createTicket({ text: "x" }));
    const assigned = await asA(() => prisma.ticket.update({ where: { id: t.id }, data: { assigneeId: "it-2b-boss" } }));
    const closed = await asA(() => saveTicket(assigned, statusChange(assigned, "closed")));
    await asA(() => saveTicket(closed, statusChange(closed, "reopened"), { actorId: "it-2b-staff" }));
    const emails = await asA(() => prisma.emailOutbox.findMany({ where: { ticketId: t.id, kind: "reopened" } }));
    expect(emails.map((e) => e.to)).toEqual(["boss@acme.test"]);
  });
});
