import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/shutdown", () => ({ registerShutdownHandlers: vi.fn() }));

const status = vi.fn();
vi.mock("@/lib/settings", () => ({ getSettingsWithStatus: () => status() }));

const env = process.env as Record<string, string | undefined>;
const saved = { ...env };

afterEach(() => {
  env.NODE_ENV = saved.NODE_ENV;
  env.NEXT_RUNTIME = saved.NEXT_RUNTIME;
  env.NEXT_PHASE = saved.NEXT_PHASE;
  env.HELPLUS_SECRET_KEY = saved.HELPLUS_SECRET_KEY;
});

describe("instrumentation register", () => {
  it("refuses to start in production without a valid key", async () => {
    env.NODE_ENV = "production";
    env.NEXT_RUNTIME = "nodejs";
    env.HELPLUS_SECRET_KEY = "short";
    const { register } = await import("@/instrumentation");
    await expect(register()).rejects.toThrow(/HELPLUS_SECRET_KEY/);
  });

  it("starts in production with a valid key", async () => {
    env.NODE_ENV = "production";
    env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });

  it("doesn't check outside production", async () => {
    env.NODE_ENV = "development";
    env.NEXT_RUNTIME = "nodejs";
    env.HELPLUS_SECRET_KEY = "";
    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });

  it("doesn't check during next build", async () => {
    env.NODE_ENV = "production";
    env.NEXT_RUNTIME = "nodejs";
    env.NEXT_PHASE = "phase-production-build";
    env.HELPLUS_SECRET_KEY = "";
    const { register } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
  });
});

describe("startup secret check", () => {
  it("logs the fields it can't decrypt, never the values, and keeps going", async () => {
    env.NODE_ENV = "production";
    env.NEXT_RUNTIME = "nodejs";
    status.mockResolvedValue({ settings: { twilioToken: "" }, undecryptable: ["twilioToken", "smtpPass"] });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const { register, checkStoredSecrets } = await import("@/instrumentation");
    await expect(register()).resolves.toBeUndefined();
    await checkStoredSecrets();
    const logged = errorLog.mock.calls.flat().join(" ");
    expect(logged).toContain("twilioToken");
    expect(logged).toContain("smtpPass");
    errorLog.mockRestore();
  });

  it("doesn't crash when the database is down", async () => {
    status.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { checkStoredSecrets } = await import("@/instrumentation");
    await expect(checkStoredSecrets()).resolves.toBeUndefined();
    expect(warnLog).toHaveBeenCalled();
    warnLog.mockRestore();
  });
});
