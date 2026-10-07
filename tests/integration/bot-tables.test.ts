import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { CrossCompanyLinkError } from "@/lib/tenant/links";

const A = "it-3c-bot-a";
const B = "it-3c-bot-b";
const DUP = "it-3c-bot-dup";
const ids = [A, B, DUP];

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: ids } } });
  for (const id of ids) await systemPrisma.company.create({ data: { id, name: id, slug: id } });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: ids } } });
  await systemPrisma.$disconnect();
});

describe("bot tables", () => {
  it("keeps chats and messages per company", async () => {
    await runWithCompany(A, async () => {
      const chat = await prisma.waChat.create({ data: { waId: "120@g.us", name: "Kedai A" } });
      await prisma.waInbound.create({
        data: { chatId: chat.id, waMessageId: "m1", senderId: "60123456789@c.us", at: new Date() },
      });
    });
    await runWithCompany(B, async () => {
      expect(await prisma.waChat.count()).toBe(0);
      // same wa ids are fine in another company
      const chat = await prisma.waChat.create({ data: { waId: "120@g.us" } });
      await prisma.waInbound.create({ data: { chatId: chat.id, waMessageId: "m1", senderId: "x", at: new Date() } });
    });
  });

  it("refuses a duplicate message id in one company", async () => {
    await runWithCompany(DUP, async () => {
      const chat = await prisma.waChat.create({ data: { waId: "1@g.us" } });
      const row = { chatId: chat.id, waMessageId: "m1", senderId: "x", at: new Date() };
      await prisma.waInbound.create({ data: row });
      await expect(prisma.waInbound.create({ data: row })).rejects.toMatchObject({ code: "P2002" });
    });
  });

  it("refuses a chat id from another company", async () => {
    const other = await runWithCompany(A, () => prisma.waChat.findFirstOrThrow());
    await runWithCompany(B, async () => {
      await expect(
        prisma.waInbound.create({ data: { chatId: other.id, waMessageId: "m9", senderId: "x", at: new Date() } })
      ).rejects.toThrow(CrossCompanyLinkError);
    });
  });
});
