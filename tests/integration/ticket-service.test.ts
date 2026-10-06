import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { nextTicketNumber } from "@/lib/tickets/number";
import { createTicket, ticketForIncomingMessage, openTicket } from "@/lib/tickets/service";
import { defaultProjectId } from "@/lib/projects/default";

const A = "it-2a-svc-a";
const B = "it-2a-svc-b";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({
    data: [
      { id: A, name: "A", slug: A },
      { id: B, name: "B", slug: B },
    ],
  });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("ticket numbers", () => {
  it("count up per company from 1", async () => {
    expect(await asA(nextTicketNumber)).toBe(1);
    expect(await asA(nextTicketNumber)).toBe(2);
    expect(await runWithCompany(B, nextTicketNumber)).toBe(1);
  });

  it("don't repeat under concurrency", async () => {
    const nums = await Promise.all(Array.from({ length: 10 }, () => asA(nextTicketNumber)));
    expect(new Set(nums).size).toBe(10);
  });
});

describe("default project", () => {
  it("is created once and reused", async () => {
    const a = await asA(defaultProjectId);
    expect(await asA(defaultProjectId)).toBe(a);
    const p = await asA(() => prisma.project.findUnique({ where: { id: a } }));
    expect(p?.name).toBe("General");
  });
});

describe("createTicket (quick add)", () => {
  it("makes a conversation, the first message and a numbered ticket, with IC hidden", async () => {
    const t = await asA(() =>
      createTicket({ text: "IC saya 900101-14-5678 tak boleh login\nTolong", customerName: "Aminah" })
    );
    expect(t.title).toBe("IC saya [IC HIDDEN] tak boleh login");
    expect(t.description).toContain("[IC HIDDEN]");
    expect(t.status).toBe("new");
    expect(t.source).toBe("quick_add");
    const msgs = await asA(() => prisma.message.findMany({ where: { conversationId: t.conversationId! } }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).not.toContain("900101");
  });
});

describe("ticketForIncomingMessage", () => {
  it("opens a ticket for a new conversation, then keeps using it", async () => {
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "whatsapp" } }));
    const first = await asA(() => ticketForIncomingMessage(conv.id, "Report kosong"));
    const second = await asA(() => ticketForIncomingMessage(conv.id, "masih kosong"));
    expect(second.id).toBe(first.id);
    expect(first.source).toBe("whatsapp");
  });

  it("opens a new ticket once the old one is closed", async () => {
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "sms" } }));
    const first = await asA(() => ticketForIncomingMessage(conv.id, "one"));
    await asA(() => prisma.ticket.update({ where: { id: first.id }, data: { status: "closed" } }));
    const next = await asA(() => ticketForIncomingMessage(conv.id, "two"));
    expect(next.id).not.toBe(first.id);
  });

  it("openTicket uses the given project", async () => {
    const p = await asA(() => prisma.project.create({ data: { name: "Alpha" } }));
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "web" } }));
    const t = await asA(() => openTicket({ conversationId: conv.id, description: "x", source: "web_form", projectId: p.id }));
    expect(t.projectId).toBe(p.id);
  });
});
