import { describe, it, expect, vi, beforeEach } from "vitest";

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
const calls: string[] = [];
const initialize = vi.fn();
const localAuth = vi.fn();
vi.mock("whatsapp-web.js", () => ({
  Client: vi.fn().mockImplementation(function () {
    return {
      on: (event: string, fn: (...args: unknown[]) => unknown) => {
        handlers[event] = fn;
      },
      initialize,
      info: { wid: { user: "60111111111" } },
      logout: vi.fn(async () => {
        calls.push("logout");
      }),
      destroy: vi.fn(async () => {
        calls.push("destroy");
      }),
    };
  }),
  LocalAuth: vi.fn().mockImplementation(function (opts: unknown) {
    localAuth(opts);
  }),
}));
vi.mock("qrcode", () => ({ toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,QR") }));

import { startClient } from "@/lib/bot/client";

const hooks = () => ({
  onQr: vi.fn().mockResolvedValue(undefined),
  onReady: vi.fn().mockResolvedValue(undefined),
  onDown: vi.fn().mockResolvedValue(undefined),
  onMessage: vi.fn().mockResolvedValue(undefined),
});

type Contact = { pushname?: string; name?: string; number?: string; id?: { server: string; user: string } };
function message(over: Record<string, unknown> = {}, contact: Contact | Error = { pushname: "Aminah" }) {
  return {
    id: { _serialized: "m1" },
    type: "chat",
    body: "printer rosak",
    fromMe: false,
    isStatus: false,
    broadcast: false,
    from: "120@g.us",
    author: "60123456789@c.us",
    timestamp: 1_760_000_000,
    hasQuotedMsg: true,
    hasMedia: false,
    getChat: async () => ({ isGroup: true, id: { _serialized: "120@g.us" }, name: "Kedai Maju" }),
    getContact: async () => {
      if (contact instanceof Error) throw contact;
      return contact;
    },
    getQuotedMessage: async () => ({ id: { _serialized: "q1" } }),
    downloadMedia: async () => ({ data: Buffer.from("img").toString("base64"), filename: "a.jpg", mimetype: "image/jpeg" }),
    ...over,
  };
}

beforeEach(() => {
  calls.length = 0;
  localAuth.mockClear();
  initialize.mockReset().mockResolvedValue(undefined);
});

describe("startClient", () => {
  it("uses the company id as the session, and the old folder for default", async () => {
    await startClient("co-a", hooks());
    await startClient("default", hooks());
    expect(localAuth.mock.calls.map(([o]) => o)).toEqual([
      { dataPath: ".wwebjs_auth", clientId: "co-a" },
      { dataPath: ".wwebjs_auth", clientId: undefined },
    ]);
  });

  it("passes the qr on as a data url and the phone on ready", async () => {
    const h = hooks();
    await startClient("co-a", h);
    await handlers.qr("qr-text");
    expect(h.onQr).toHaveBeenCalledWith("data:image/png;base64,QR");
    await handlers.ready();
    expect(h.onReady).toHaveBeenCalledWith("60111111111");
  });

  it("reports disconnects and auth failures", async () => {
    const h = hooks();
    await startClient("co-a", h);
    await handlers.disconnected("LOGOUT");
    await handlers.auth_failure("bad session");
    expect(h.onDown.mock.calls).toEqual([["LOGOUT"], ["bad session"]]);
  });

  it("maps a group message with its author and quote", async () => {
    const h = hooks();
    await startClient("co-a", h);
    await handlers.message(message());
    expect(h.onMessage).toHaveBeenCalledWith({
      waMessageId: "m1",
      chatWaId: "120@g.us",
      chatName: "Kedai Maju",
      isGroup: true,
      senderId: "60123456789@c.us",
      senderName: "Aminah",
      text: "printer rosak",
      at: new Date(1_760_000_000_000),
      quotedWaId: "q1",
      media: null,
    });
  });

  it("downloads media as a buffer", async () => {
    const h = hooks();
    await startClient("co-a", h);
    await handlers.message(message({ hasMedia: true, hasQuotedMsg: false }));
    const e = h.onMessage.mock.calls[0][0];
    expect(e.quotedWaId).toBeNull();
    expect(e.media).toEqual({ data: Buffer.from("img"), fileName: "a.jpg", mime: "image/jpeg" });
  });

  it("skips its own, status and broadcast messages", async () => {
    const h = hooks();
    await startClient("co-a", h);
    await handlers.message(message({ fromMe: true }));
    await handlers.message(message({ isStatus: true }));
    await handlers.message(
      message({ getChat: async () => ({ isGroup: false, id: { _serialized: "status@broadcast" }, name: "" }) })
    );
    expect(h.onMessage).not.toHaveBeenCalled();
  });

  it("skips stickers, reactions, deleted messages and system events", async () => {
    const h = hooks();
    await startClient("co-a", h);
    for (const type of ["sticker", "reaction", "revoked", "call_log", "e2e_notification", "notification_template"]) {
      await handlers.message(message({ type, hasMedia: type === "sticker" }));
    }
    expect(h.onMessage).not.toHaveBeenCalled();
  });

  it("uses a placeholder for locations and contact cards", async () => {
    const h = hooks();
    await startClient("co-a", h);
    await handlers.message(message({ type: "location", body: "/9j/4AAQSkZJRgABAQ", hasMedia: true }));
    await handlers.message(message({ type: "vcard", body: "BEGIN:VCARD..." }));
    expect(h.onMessage.mock.calls.map(([e]) => [e.text, e.media])).toEqual([
      ["[location]", null],
      ["[contact card]", null],
    ]);
  });

  it("swallows errors while reading a message", async () => {
    const h = hooks();
    await startClient("co-a", h);
    await handlers.message(message({ getChat: async () => Promise.reject(new Error("gone")) }));
    expect(h.onMessage).not.toHaveBeenCalled();
  });

  it("stop(true) logs out then destroys, stop(false) only destroys", async () => {
    const handle = await startClient("co-a", hooks());
    await handle.stop(true);
    expect(calls).toEqual(["logout", "destroy"]);
    calls.length = 0;
    await handle.stop(false);
    expect(calls).toEqual(["destroy"]);
  });

  it("destroys the client when it can't start", async () => {
    initialize.mockRejectedValueOnce(new Error("no browser"));
    await expect(startClient("co-a", hooks())).rejects.toThrow("no browser");
    expect(calls).toEqual(["destroy"]);
  });
});

describe("@lid senders", () => {
  it("resolves a lid author to the contact's phone number", async () => {
    const h = hooks();
    await startClient("co-a", h);
    const contact = { pushname: "Ali", number: "60199999999", id: { server: "c.us", user: "60199999999" } };
    await handlers.message(message({ author: "998877@lid" }, contact));
    expect(h.onMessage.mock.calls[0][0].senderId).toBe("60199999999@c.us");
  });

  it("uses the number when the contact id is still a lid", async () => {
    const h = hooks();
    await startClient("co-a", h);
    await handlers.message(message({ author: "998877@lid" }, { pushname: "Ali", number: "60188888888", id: { server: "lid", user: "998877" } }));
    expect(h.onMessage.mock.calls[0][0].senderId).toBe("60188888888@c.us");
  });

  it("keeps the lid when no number resolves", async () => {
    const h = hooks();
    await startClient("co-a", h);
    await handlers.message(message({ author: "998877@lid" }, { pushname: "Ali", number: "998877", id: { server: "lid", user: "998877" } }));
    await handlers.message(message({ author: undefined, from: "998877@lid" }, new Error("no contact")));
    expect(h.onMessage.mock.calls.map(([e]) => e.senderId)).toEqual(["998877@lid", "998877@lid"]);
  });
});
