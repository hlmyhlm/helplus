import { describe, it, expect, vi, beforeEach } from "vitest";

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
  imapEnd.mockClear();
  const { runWithCompany } = await import("@/lib/tenant/context");
  asA = (fn) => runWithCompany("co-a", fn);
  asB = (fn) => runWithCompany("co-b", fn);
  ({ ChannelInUseError } = await import("@/lib/errors"));
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
