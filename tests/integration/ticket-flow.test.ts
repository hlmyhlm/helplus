import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { ticketForIncomingMessage } from "@/lib/tickets/service";
import { saveTicket } from "@/lib/tickets/update";
import { statusChange } from "@/lib/tickets/status";

const A = "it-2b-flow";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "A", slug: A } });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
});

describe("client messages", () => {
  it("move an answered ticket to staff working, without counting a reopen", async () => {
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "whatsapp" } }));
    const t = await asA(() => ticketForIncomingMessage(conv.id, "report kosong"));
    await asA(() => saveTicket(t, statusChange(t, "answered")));
    const after = await asA(() => ticketForIncomingMessage(conv.id, "masih kosong"));
    expect(after.id).toBe(t.id);
    expect(after.status).toBe("working");
    expect(after.reopenCount).toBe(0);
    expect(after.slaPausedAt).toBeNull();
  });

  it("leave other open statuses alone", async () => {
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "whatsapp" } }));
    const t = await asA(() => ticketForIncomingMessage(conv.id, "one"));
    const again = await asA(() => ticketForIncomingMessage(conv.id, "two"));
    expect(again.status).toBe("new");
    expect(again.id).toBe(t.id);
  });

  it("don't send a follow-up into an archived project", async () => {
    const archived = await asA(() => prisma.project.create({ data: { name: "Old client", archived: true } }));
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "whatsapp" } }));
    const first = await asA(() => ticketForIncomingMessage(conv.id, "one"));
    await asA(() => prisma.ticket.update({ where: { id: first.id }, data: { projectId: archived.id, status: "closed" } }));
    const next = await asA(() => ticketForIncomingMessage(conv.id, "two"));
    expect(next.projectId).not.toBe(archived.id);
  });
});
