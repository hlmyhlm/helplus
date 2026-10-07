import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { channelKey } from "@/lib/tenant/keys";
import { readBot, requestStart, requestStop, setBot, heartbeat } from "@/lib/bot/state";
import { emailBotDown } from "@/lib/notify/bot";

const A = "it-3c-bot-state";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);

beforeEach(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "Acme", slug: A } });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
});

describe("bot state on the channel row", () => {
  it("starts from off once", async () => {
    await asA(async () => {
      expect((await readBot()).status).toBe("off");
      expect(await requestStart()).toBe(true);
      expect((await readBot()).status).toBe("starting");
      expect(await requestStart()).toBe(false);
    });
  });

  it("only moves from the expected status", async () => {
    await asA(async () => {
      await requestStart();
      expect(await setBot(["starting"], "qr", { qr: "data:image/png;base64,QR" })).toBe(true);
      expect((await readBot()).qr).toBe("data:image/png;base64,QR");
      expect(await requestStop(false)).toBe(true);
      expect(await setBot(["starting"], "connected", { phone: "60111" })).toBe(false);
      const s = await readBot();
      expect(s.status).toBe("stopping");
      expect(s.phone).toBe("");
    });
  });

  it("merges config instead of replacing it", async () => {
    await asA(async () => {
      await requestStart();
      await setBot(["starting"], "qr", { qr: "data:x" });
      await setBot(["qr"], "qr", { phone: "60111" });
      const s = await readBot();
      expect(s.qr).toBe("data:x");
      expect(s.phone).toBe("60111");
    });
  });

  it("treats a legacy error row as off", async () => {
    await asA(async () => {
      await prisma.channel.create({ data: { type: "whatsapp", status: "error", config: { error: "old" } } });
      expect((await readBot()).status).toBe("off");
      expect(await requestStart()).toBe(true);
      expect((await readBot()).error).toBe("");
    });
  });

  it("heartbeats only while connected", async () => {
    await asA(async () => {
      const now = new Date("2026-10-07T10:00:00Z");
      await requestStart();
      await heartbeat(now);
      expect((await readBot()).seenAt).toBeNull();
      await setBot(["starting"], "connected", { phone: "60111" });
      await heartbeat(now);
      expect((await readBot()).seenAt).toEqual(now);
      const row = await prisma.channel.findUniqueOrThrow({ where: channelKey("whatsapp") });
      expect(row.isActive).toBe(true);
    });
  });
});

describe("emailBotDown", () => {
  it("queues one email per admin or owner with an email", async () => {
    await asA(() =>
      prisma.admin.createMany({
        data: [
          { id: "it-3c-owner", username: "it-3c-owner", password: "x", role: "owner", email: "owner@acme.test" },
          { id: "it-3c-admin", username: "it-3c-admin", password: "x", role: "admin", email: "admin@acme.test" },
          { id: "it-3c-noemail", username: "it-3c-noemail", password: "x", role: "admin", email: "" },
          { id: "it-3c-sup", username: "it-3c-sup", password: "x", role: "supervisor", email: "sup@acme.test" },
        ],
      })
    );
    expect(await asA(() => emailBotDown())).toBe(2);
    const emails = await asA(() => prisma.emailOutbox.findMany({ orderBy: { to: "asc" } }));
    expect(emails.map((e) => [e.to, e.kind])).toEqual([
      ["admin@acme.test", "bot_disconnected"],
      ["owner@acme.test", "bot_disconnected"],
    ]);
    expect(emails[0].subject).toBe("WhatsApp bot disconnected");
    expect(emails[0].body).toContain("The WhatsApp bot for Acme was disconnected.");
    expect(emails[0].body).toContain("/channels");
  });
});
