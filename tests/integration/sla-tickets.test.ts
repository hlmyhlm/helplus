import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { createTicket } from "@/lib/tickets/service";
import { saveTicket } from "@/lib/tickets/update";
import { statusChange } from "@/lib/tickets/status";

const A = "it-2b-sla";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "A", slug: A } });
  await asA(() =>
    prisma.sLARule.createMany({
      data: [
        { name: "default", firstResponseMins: 60, resolutionMins: 480 },
        { name: "urgent", priority: "urgent", firstResponseMins: 15, resolutionMins: 120 },
      ],
    })
  );
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
});

describe("sla on real tickets", () => {
  it("gets due times from the matching rule", async () => {
    const t = await asA(() => createTicket({ text: "printer down", priority: "urgent" }));
    expect(t.firstReplyDueAt!.getTime() - t.createdAt.getTime()).toBe(15 * 60_000);
    expect(t.resolveDueAt!.getTime() - t.createdAt.getTime()).toBe(120 * 60_000);
  });

  it("pauses while answered and moves the due time after", async () => {
    const t = await asA(() => createTicket({ text: "report empty" }));
    const answeredAt = new Date(t.createdAt.getTime() + 10 * 60_000);
    const answered = await asA(() => saveTicket(t, statusChange(t, "answered", answeredAt), { now: answeredAt }));
    expect(answered.slaPausedAt).toEqual(answeredAt);
    const back = new Date(answeredAt.getTime() + 60 * 60_000);
    const working = await asA(() => saveTicket(answered, statusChange(answered, "working", back), { now: back }));
    expect(working.slaPausedMins).toBe(60);
    expect(working.resolveDueAt!.getTime() - t.createdAt.getTime()).toBe((480 + 60) * 60_000);
  });
});
