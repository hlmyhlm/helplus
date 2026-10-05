import { describe, it, expect, vi, beforeEach } from "vitest";

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
const destroy = vi.fn().mockResolvedValue(undefined);
const sendMessage = vi.fn().mockResolvedValue(undefined);
const initialize = vi.fn().mockResolvedValue(undefined);
const localAuth = vi.fn();
vi.mock("whatsapp-web.js", () => ({
  Client: vi.fn().mockImplementation(function () {
    return {
      on: (event: string, fn: (...args: unknown[]) => unknown) => {
        handlers[event] = fn;
      },
      initialize,
      destroy,
      sendMessage,
    };
  }),
  LocalAuth: vi.fn().mockImplementation(function (opts: unknown) {
    localAuth(opts);
  }),
}));
vi.mock("qrcode", () => ({ toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,QR") }));

const imapHandlers: Record<string, (...args: unknown[]) => unknown> = {};
const imapEnd = vi.fn();
vi.mock("imap", () => ({
  default: vi.fn().mockImplementation(function () {
    return {
      once: (event: string, fn: (...args: unknown[]) => unknown) => {
        imapHandlers[event] = fn;
      },
      on: vi.fn(),
      openBox: vi.fn(),
      connect: vi.fn(),
      end: imapEnd,
    };
  }),
}));
vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn().mockResolvedValue({
    imapHost: "imap.test",
    imapPort: 993,
    imapUser: "u",
    imapPass: "p",
    smtpHost: "smtp.test",
    smtpPort: 465,
    smtpUser: "u",
    smtpPass: "p",
    smtpFrom: "",
  }),
}));

// modules are reset per test for fresh listener state, so the context and error come from the same fresh graph
let asA: <T>(fn: () => T) => T;
let asB: <T>(fn: () => T) => T;
let ChannelInUseError: new (...args: never[]) => Error;

beforeEach(async () => {
  vi.resetModules();
  destroy.mockClear();
  sendMessage.mockClear();
  initialize.mockReset().mockResolvedValue(undefined);
  localAuth.mockClear();
  imapEnd.mockClear();
  const { runWithCompany } = await import("@/lib/tenant/context");
  asA = (fn) => runWithCompany("co-a", fn);
  asB = (fn) => runWithCompany("co-b", fn);
  ({ ChannelInUseError } = await import("@/lib/errors"));
});

describe("whatsapp belongs to the company that connected it", () => {
  async function connectedAsA() {
    const wa = await import("@/lib/channels/whatsapp");
    await asA(() => wa.initWhatsApp());
    await handlers.qr("qr-text");
    return wa;
  }

  it("the owner sees its status and QR", async () => {
    const wa = await connectedAsA();
    const status = asA(() => wa.getWhatsAppStatus());
    expect(status.status).toBe("qr_ready");
    expect(status.qr).toBe("data:image/png;base64,QR");
  });

  it("another company sees disconnected with no QR and no message", async () => {
    const wa = await connectedAsA();
    expect(asB(() => wa.getWhatsAppStatus())).toEqual({ status: "disconnected", qr: null, message: "" });
  });

  it("another company can't connect, disconnect or send", async () => {
    const wa = await connectedAsA();
    await expect(asB(() => wa.initWhatsApp())).rejects.toThrow(ChannelInUseError);
    await expect(asB(() => wa.disconnectWhatsApp())).rejects.toThrow(ChannelInUseError);
    expect(destroy).not.toHaveBeenCalled();
    await handlers.ready();
    expect(await asB(() => wa.sendWhatsAppMessage("+1555", "hi"))).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("frees the client for another company once the owner disconnects", async () => {
    const wa = await connectedAsA();
    await asA(() => wa.disconnectWhatsApp());
    expect(destroy).toHaveBeenCalled();
    await expect(asB(() => wa.initWhatsApp())).resolves.toBeUndefined();
  });
});

describe("whatsapp sessions and failures", () => {
  it("each company gets its own saved session, default keeps the old one", async () => {
    const wa = await import("@/lib/channels/whatsapp");
    const { runWithCompany } = await import("@/lib/tenant/context");
    await asA(() => wa.initWhatsApp());
    await asA(() => wa.disconnectWhatsApp());
    await asB(() => wa.initWhatsApp());
    await asB(() => wa.disconnectWhatsApp());
    await runWithCompany("default", () => wa.initWhatsApp());
    const ids = localAuth.mock.calls.map(([o]) => (o as { clientId?: string }).clientId);
    expect(ids).toEqual(["co-a", "co-b", undefined]);
  });

  it("a failed initialize frees the client for another company", async () => {
    const wa = await import("@/lib/channels/whatsapp");
    initialize.mockRejectedValueOnce(new Error("no browser"));
    await expect(asA(() => wa.initWhatsApp())).rejects.toThrow("no browser");
    await expect(asB(() => wa.initWhatsApp())).resolves.toBeUndefined();
  });

  it("an auth failure frees the client for another company", async () => {
    const wa = await import("@/lib/channels/whatsapp");
    await asA(() => wa.initWhatsApp());
    await handlers.auth_failure("bad session");
    await expect(asB(() => wa.initWhatsApp())).resolves.toBeUndefined();
  });

  it("incoming messages run as the company that connected", async () => {
    const wa = await import("@/lib/channels/whatsapp");
    const { currentCompanyId } = await import("@/lib/tenant/context");
    await asA(() => wa.initWhatsApp());
    let seen: string | undefined;
    const message = {
      get fromMe() {
        seen = currentCompanyId();
        return true;
      },
    };
    await handlers.message(message);
    expect(seen).toBe("co-a");
  });
});

describe("the email listener belongs to the company that started it", () => {
  async function startedAsA() {
    const email = await import("@/lib/channels/email");
    await asA(() => email.startEmailListener());
    imapHandlers.ready();
    return email;
  }

  it("the owner sees its own status", async () => {
    const email = await startedAsA();
    expect(asA(() => email.getEmailStatus())).toEqual({ connected: true, status: "connected" });
  });

  it("another company sees disconnected", async () => {
    const email = await startedAsA();
    expect(asB(() => email.getEmailStatus())).toEqual({ connected: false, status: "disconnected" });
  });

  it("another company can't start or stop it", async () => {
    const email = await startedAsA();
    await expect(asB(() => email.startEmailListener())).rejects.toThrow(ChannelInUseError);
    await expect(asB(() => email.stopEmailListener())).rejects.toThrow(ChannelInUseError);
    expect(imapEnd).not.toHaveBeenCalled();
  });

  it("frees the listener for another company once the owner stops it", async () => {
    const email = await startedAsA();
    await asA(() => email.stopEmailListener());
    expect(imapEnd).toHaveBeenCalled();
    await expect(asB(() => email.startEmailListener())).resolves.toBeUndefined();
  });
});
