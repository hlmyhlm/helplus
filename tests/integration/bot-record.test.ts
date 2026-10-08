import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { defaultProjectId } from "@/lib/projects/default";
import { recordInbound, type IncomingEvent } from "@/lib/bot/record";
import { fileStore, botMediaKey } from "@/lib/storage";

const ids = ["rec-1", "rec-2", "rec-3", "rec-4", "rec-5", "rec-6", "rec-7", "rec-8", "rec-9", "rec-10", "rec-11", "rec-12"].map((s) => `it-3c-${s}`);
let dir: string;
const savedDir = process.env.HELPLUS_STORAGE_DIR;

async function makeCompany(name: string): Promise<string> {
  const id = `it-3c-${name}`;
  await systemPrisma.company.create({ data: { id, name: id, slug: id } });
  await runWithCompany(id, () => defaultProjectId());
  return id;
}

const base = (over: Partial<IncomingEvent> = {}): IncomingEvent => ({
  waMessageId: "m1", chatWaId: "120@g.us", chatName: "Kedai Maju", isGroup: true,
  senderId: "60123456789@c.us", senderName: "Aminah", text: "printer rosak", at: new Date(),
  quotedWaId: null, media: null, ...over,
});

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: ids } } });
  dir = mkdtempSync(path.join(tmpdir(), "helplus-bot-record-"));
  process.env.HELPLUS_STORAGE_DIR = dir;
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: ids } } });
  await systemPrisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
  if (savedDir === undefined) delete process.env.HELPLUS_STORAGE_DIR;
  else process.env.HELPLUS_STORAGE_DIR = savedDir;
});

describe("recordInbound", () => {
  it("shows a new group but ignores its messages until linked", async () => {
    await runWithCompany(await makeCompany("rec-1"), async () => {
      expect(await recordInbound(base(), "60111111111")).toBe("not_linked");
      expect(await prisma.waChat.count()).toBe(1);
      expect(await prisma.waInbound.count()).toBe(0);
    });
  });

  it("saves masked text once a group is linked, and skips duplicates", async () => {
    await runWithCompany(await makeCompany("rec-2"), async () => {
      const project = await prisma.project.findFirstOrThrow();
      await recordInbound(base(), "60111111111");
      await prisma.waChat.updateMany({ data: { projectId: project.id } });
      expect(await recordInbound(base({ text: "IC saya 900101-14-5678" }), "60111111111")).toBe("saved");
      expect(await recordInbound(base({ text: "IC saya 900101-14-5678" }), "60111111111")).toBe("duplicate");
      const row = await prisma.waInbound.findFirstOrThrow();
      expect(row.text).toBe("IC saya [IC HIDDEN]");
      expect(row.isStaff).toBe(false);
    });
  });

  it("links a private chat to the default project straight away", async () => {
    await runWithCompany(await makeCompany("rec-3"), async () => {
      expect(await recordInbound(base({ chatWaId: "60123456789@c.us", isGroup: false }), "60111111111")).toBe("saved");
      const chat = await prisma.waChat.findFirstOrThrow();
      expect(chat.projectId).toBe(await defaultProjectId());
    });
  });

  it("marks team members as staff and stores images encrypted", async () => {
    const co = await makeCompany("rec-4");
    await runWithCompany(co, async () => {
      const dept = await prisma.department.create({ data: { name: "Support" } });
      await prisma.teamMember.create({ data: { name: "Ali", email: "ali@x.my", phone: "012-345 6789", departmentId: dept.id } });
      const project = await prisma.project.findFirstOrThrow();
      await prisma.waChat.create({ data: { waId: "120@g.us", projectId: project.id } });
      const png = Buffer.from("89504e470d0a1a0a", "hex");
      await recordInbound(base({ media: { data: png, fileName: "a.png", mime: "image/png" } }), "60111111111");
      const row = await prisma.waInbound.findFirstOrThrow();
      expect(row.isStaff).toBe(true);
      expect(row.mediaKey).toBe(botMediaKey(co, row.id));
      expect(row.mediaName).toBe("a.png");
      const stored = await fileStore().get(row.mediaKey!);
      expect(stored.equals(png)).toBe(false); // encrypted
    });
  });

  it("skips empty system messages", async () => {
    await runWithCompany(await makeCompany("rec-5"), async () => {
      const project = await prisma.project.findFirstOrThrow();
      await prisma.waChat.create({ data: { waId: "120@g.us", projectId: project.id } });
      expect(await recordInbound(base({ text: "  " }), "x")).toBe("skipped");
      expect(await prisma.waInbound.count()).toBe(0);
    });
  });

  it("links a private chat to the customer's project unless it's archived", async () => {
    await runWithCompany(await makeCompany("rec-6"), async () => {
      const shop = await prisma.project.create({ data: { name: "Kedai Maju" } });
      const old = await prisma.project.create({ data: { name: "Old", archived: true } });
      await prisma.customer.create({ data: { name: "Aminah", whatsapp: "60123456789", projectId: shop.id } });
      await prisma.customer.create({ data: { name: "Badrul", whatsapp: "60199999999", projectId: old.id } });
      await recordInbound(base({ chatWaId: "60123456789@c.us", isGroup: false }), "60111111111");
      await recordInbound(
        base({ waMessageId: "m2", chatWaId: "60199999999@c.us", senderId: "60199999999@c.us", isGroup: false }),
        "60111111111"
      );
      expect((await prisma.waChat.findFirstOrThrow({ where: { waId: "60123456789@c.us" } })).projectId).toBe(shop.id);
      expect((await prisma.waChat.findFirstOrThrow({ where: { waId: "60199999999@c.us" } })).projectId).toBe(
        await defaultProjectId()
      );
    });
  });

  it("masks chat and sender names and notes non-image media", async () => {
    await runWithCompany(await makeCompany("rec-7"), async () => {
      const project = await prisma.project.findFirstOrThrow();
      await prisma.waChat.create({ data: { waId: "120@g.us", projectId: project.id } });
      const voice = { data: Buffer.from("x"), fileName: "", mime: "audio/ogg; codecs=opus" };
      const doc = { data: Buffer.from("x"), fileName: "ic 900101-14-5678.pdf", mime: "application/pdf" };
      await recordInbound(
        base({ chatName: "Grup 900101-14-5678", senderName: "Ali 900101145678", text: "", media: voice }),
        "60111111111"
      );
      expect((await prisma.waChat.findFirstOrThrow()).name).toBe("Grup [IC HIDDEN]");
      await recordInbound(base({ waMessageId: "m2", text: "ini dia", media: doc }), "60111111111");
      expect((await prisma.waChat.findFirstOrThrow()).name).toBe("Kedai Maju");
      const rows = await prisma.waInbound.findMany({ orderBy: { waMessageId: "asc" } });
      expect(rows.map((r) => r.text)).toEqual(["[voice message]", "[document: ic [IC HIDDEN].pdf] ini dia"]);
      expect(rows[0].senderName).toBe("Ali [IC HIDDEN]");
      expect(rows.every((r) => r.mediaKey === null)).toBe(true);
    });
  });

  it("never treats the bot's own number or a lid id as staff by phone", async () => {
    await runWithCompany(await makeCompany("rec-8"), async () => {
      const dept = await prisma.department.create({ data: { name: "Support" } });
      await prisma.teamMember.create({ data: { name: "Bot", email: "b@x.my", phone: "0111111111", departmentId: dept.id } });
      await prisma.teamMember.create({ data: { name: "No phone", email: "n@x.my", departmentId: dept.id } });
      await prisma.chatSender.create({ data: { name: "Siti", isStaff: true } });
      await prisma.chatSender.create({ data: { name: "", isStaff: true } });
      const project = await prisma.project.findFirstOrThrow();
      await prisma.waChat.create({ data: { waId: "120@g.us", projectId: project.id } });
      await recordInbound(base({ waMessageId: "a", senderId: "60111111111@c.us" }), "60111111111");
      await recordInbound(base({ waMessageId: "b", senderId: "123456789012345@lid" }), "60111111111");
      await recordInbound(base({ waMessageId: "d", senderId: "123456789012345@lid", senderName: "" }), "60111111111");
      await recordInbound(base({ waMessageId: "c", senderId: "123456789012345@lid", senderName: "Siti" }), "60111111111");
      const rows = await prisma.waInbound.findMany({ orderBy: { waMessageId: "asc" } });
      expect(rows.map((r) => r.isStaff)).toEqual([false, false, true, false]);
    });
  });

  it("matches a private chat customer saved in local format", async () => {
    await runWithCompany(await makeCompany("rec-9"), async () => {
      const a = await prisma.project.create({ data: { name: "A" } });
      const b = await prisma.project.create({ data: { name: "B" } });
      await prisma.customer.create({ data: { name: "Aminah", whatsapp: "012-345 6789", projectId: a.id } });
      await prisma.customer.create({ data: { name: "Badrul", phone: "+60 19-999 9999", projectId: b.id } });
      // a longer number that only contains the digits must not match
      await prisma.customer.create({ data: { name: "Other", whatsapp: "601234567890", projectId: b.id } });
      await recordInbound(base({ chatWaId: "60123456789@c.us", isGroup: false }), "60111111111");
      await recordInbound(
        base({ waMessageId: "m2", chatWaId: "60199999999@c.us", senderId: "60199999999@c.us", isGroup: false }),
        "60111111111"
      );
      expect((await prisma.waChat.findFirstOrThrow({ where: { waId: "60123456789@c.us" } })).projectId).toBe(a.id);
      expect((await prisma.waChat.findFirstOrThrow({ where: { waId: "60199999999@c.us" } })).projectId).toBe(b.id);
    });
  });

  it("saves no row when the image can't be stored, so a redelivery works", async () => {
    const co = await makeCompany("rec-10");
    await runWithCompany(co, async () => {
      const project = await prisma.project.findFirstOrThrow();
      await prisma.waChat.create({ data: { waId: "120@g.us", projectId: project.id } });
      const img = base({ media: { data: Buffer.from("png"), fileName: "a.png", mime: "image/png" } });
      const blocker = path.join(dir, "not-a-folder");
      writeFileSync(blocker, "x");
      process.env.HELPLUS_STORAGE_DIR = blocker;
      try {
        await expect(recordInbound(img, "60111111111")).rejects.toThrow();
      } finally {
        process.env.HELPLUS_STORAGE_DIR = dir;
      }
      expect(await prisma.waInbound.count()).toBe(0);
      expect(await recordInbound(img, "60111111111")).toBe("saved");
      // a duplicate image leaves no stray file behind
      expect(await recordInbound(img, "60111111111")).toBe("duplicate");
      expect(readdirSync(path.join(dir, "c", co, "bot"))).toHaveLength(1);
    });
  });

  it("keeps lastMessageAt moving forward and labels audio", async () => {
    await runWithCompany(await makeCompany("rec-11"), async () => {
      const project = await prisma.project.findFirstOrThrow();
      await prisma.waChat.create({ data: { waId: "120@g.us", projectId: project.id } });
      const late = new Date("2026-10-07T10:00:00Z");
      const voice = { data: Buffer.from("x"), fileName: "", mime: "audio/ogg; codecs=opus" };
      const mp3 = { data: Buffer.from("x"), fileName: "lagu.mp3", mime: "audio/mpeg" };
      await recordInbound(base({ waMessageId: "a", at: late, text: "", media: voice }), "60111111111");
      await recordInbound(base({ waMessageId: "b", at: new Date("2026-10-07T09:00:00Z"), text: "", media: mp3 }), "x");
      expect((await prisma.waChat.findFirstOrThrow()).lastMessageAt).toEqual(late);
      const rows = await prisma.waInbound.findMany({ orderBy: { waMessageId: "asc" } });
      expect(rows.map((r) => r.text)).toEqual(["[voice message]", "[audio]"]);
    });
  });
  it("notes heic, tiff, svg and empty images as documents without storing them", async () => {
    await runWithCompany(await makeCompany("rec-12"), async () => {
      const project = await prisma.project.findFirstOrThrow();
      await prisma.waChat.create({ data: { waId: "120@g.us", projectId: project.id } });
      const odd = [
        { data: Buffer.from("x"), fileName: "photo.heic", mime: "image/heic" },
        { data: Buffer.from("x"), fileName: "scan.tiff", mime: "image/tiff" },
        { data: Buffer.from("x"), fileName: "logo.svg", mime: "image/svg+xml" },
        { data: Buffer.alloc(0), fileName: "big.png", mime: "image/png" },
      ];
      for (const [n, media] of odd.entries()) {
        expect(await recordInbound(base({ waMessageId: `m${n}`, text: "", media }), "x")).toBe("saved");
      }
      const rows = await prisma.waInbound.findMany({ orderBy: { waMessageId: "asc" } });
      expect(rows.map((r) => r.text)).toEqual([
        "[document: photo.heic]",
        "[document: scan.tiff]",
        "[document: logo.svg]",
        "[document: big.png]",
      ]);
      expect(rows.every((r) => r.mediaKey === null && r.mediaName === null)).toBe(true);
    });
  });
});
