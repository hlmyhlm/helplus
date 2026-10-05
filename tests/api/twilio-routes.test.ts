import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fixtures } from "../helpers/fixtures";
import { encryptSecret } from "@/lib/secrets";

vi.mock("@/lib/channels/phone", () => ({
  handleIncomingCall: vi.fn().mockResolvedValue("<Response/>"),
  handleSpeechInput: vi.fn().mockResolvedValue("<Response/>"),
  handleCallEnd: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/channels/sms", () => ({
  handleIncomingSms: vi.fn().mockResolvedValue("ok"),
}));
vi.mock("@/lib/channels/telegram", () => ({
  handleTelegramUpdate: vi.fn().mockResolvedValue(undefined),
}));

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const KEY = process.env.HELPLUS_SECRET_KEY;
const OTHER_KEY = "b2".repeat(32);

const routes = [
  ["phone/incoming", () => import("@/app/api/channels/phone/incoming/route")],
  ["phone/gather", () => import("@/app/api/channels/phone/gather/route")],
  ["phone/status", () => import("@/app/api/channels/phone/status/route")],
  ["sms", () => import("@/app/api/channels/sms/route")],
] as const;

function twilioRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/channels/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: "+1555", CallSid: "CA1", Body: "hi", CallStatus: "ringing" }).toString(),
  });
}

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mockPrisma.company.findMany.mockResolvedValue([{ id: "test-company" }]);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  warnLog = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  process.env.HELPLUS_SECRET_KEY = KEY;
  errorLog.mockRestore();
  warnLog.mockRestore();
});

describe("twilio webhooks", () => {
  it.each(routes)("%s rejects when the stored token can't be decrypted", async (_path, load) => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings, twilioToken: encryptSecret("tw-token") });
    process.env.HELPLUS_SECRET_KEY = OTHER_KEY;
    const { POST } = await load();
    const response = await POST(twilioRequest(_path));
    expect(response.status).toBe(403);
  });

  it.each(routes)("%s rejects a bad signature when a token is set", async (_path, load) => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings, twilioToken: encryptSecret("tw-token") });
    const { POST } = await load();
    const response = await POST(twilioRequest(_path));
    expect(response.status).toBe(403);
  });

  // no token configured means signatures can't be checked, so the request is refused
  it.each(routes)("%s rejects when no token is configured", async (_path, load) => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings, twilioToken: "" });
    const { POST } = await load();
    const response = await POST(twilioRequest(_path));
    expect(response.status).toBe(403);
  });

  it.each(routes)("%s allows no token when HELPLUS_ALLOW_UNSIGNED_WEBHOOKS is set", async (_path, load) => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings, twilioToken: "" });
    const saved = process.env.HELPLUS_ALLOW_UNSIGNED_WEBHOOKS;
    process.env.HELPLUS_ALLOW_UNSIGNED_WEBHOOKS = "true";
    try {
      const { POST } = await load();
      const response = await POST(twilioRequest(_path));
      expect(response.status).toBe(200);
    } finally {
      process.env.HELPLUS_ALLOW_UNSIGNED_WEBHOOKS = saved;
    }
  });
});

describe("webhook company", () => {
  const allRoutes = [
    ...routes,
    ["telegram", () => import("@/app/api/channels/telegram/route")],
  ] as const;

  it.each(allRoutes)("%s returns 404 when there are several companies and no ?company=", async (_path, load) => {
    mockPrisma.company.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const { POST } = await load();
    const response = await POST(twilioRequest(_path));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Unknown company");
  });
});
