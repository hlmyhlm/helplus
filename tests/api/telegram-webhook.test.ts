import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fixtures } from "../helpers/fixtures";
import { encryptSecret } from "@/lib/secrets";
import { handleTelegramUpdate } from "@/lib/channels/telegram";

vi.mock("@/lib/channels/telegram", () => ({
  handleTelegramUpdate: vi.fn().mockResolvedValue(undefined),
}));

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const SECRET = "tg-webhook-secret";

function telegramRequest(secret?: string): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers["x-telegram-bot-api-secret-token"] = secret;
  return new NextRequest("http://localhost:3000/api/channels/telegram", {
    method: "POST",
    headers,
    body: JSON.stringify({ update_id: 1, message: { text: "hi" } }),
  });
}

function withSecret(secret: string) {
  mockPrisma.settings.upsert.mockResolvedValue({
    ...fixtures.settings,
    telegramWebhookSecret: secret ? encryptSecret(secret) : "",
  });
}

async function post(request: NextRequest) {
  const { POST } = await import("@/app/api/channels/telegram/route");
  return POST(request);
}

let savedFlag: string | undefined;

beforeEach(() => {
  mockPrisma.company.findMany.mockResolvedValue([{ id: "test-company" }]);
  vi.mocked(handleTelegramUpdate).mockClear();
  savedFlag = process.env.HELPLUS_ALLOW_UNSIGNED_WEBHOOKS;
  delete process.env.HELPLUS_ALLOW_UNSIGNED_WEBHOOKS;
});

afterEach(() => {
  if (savedFlag === undefined) delete process.env.HELPLUS_ALLOW_UNSIGNED_WEBHOOKS;
  else process.env.HELPLUS_ALLOW_UNSIGNED_WEBHOOKS = savedFlag;
});

describe("telegram webhook secret", () => {
  it("accepts the right secret", async () => {
    withSecret(SECRET);
    const response = await post(telegramRequest(SECRET));
    expect(response.status).toBe(200);
    expect(handleTelegramUpdate).toHaveBeenCalled();
  });

  it("refuses a wrong secret", async () => {
    withSecret(SECRET);
    const response = await post(telegramRequest("nope"));
    expect(response.status).toBe(403);
    expect(handleTelegramUpdate).not.toHaveBeenCalled();
  });

  it("refuses a missing header", async () => {
    withSecret(SECRET);
    const response = await post(telegramRequest());
    expect(response.status).toBe(403);
    expect(handleTelegramUpdate).not.toHaveBeenCalled();
  });

  it("refuses when no secret is configured", async () => {
    withSecret("");
    const response = await post(telegramRequest());
    expect(response.status).toBe(403);
    expect(handleTelegramUpdate).not.toHaveBeenCalled();
  });

  it("allows no secret when HELPLUS_ALLOW_UNSIGNED_WEBHOOKS is set", async () => {
    withSecret("");
    process.env.HELPLUS_ALLOW_UNSIGNED_WEBHOOKS = "true";
    const response = await post(telegramRequest());
    expect(response.status).toBe(200);
    expect(handleTelegramUpdate).toHaveBeenCalled();
  });
});
