import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { ChannelInUseError } from "@/lib/errors";

vi.mock("@/lib/channels/whatsapp", async () => {
  const { ChannelInUseError } = await import("@/lib/errors");
  const inUse = () => Promise.reject(new ChannelInUseError("WhatsApp"));
  return { getWhatsAppStatus: vi.fn(), initWhatsApp: vi.fn(inUse), disconnectWhatsApp: vi.fn(inUse) };
});
vi.mock("@/lib/channels/email", async () => {
  const { ChannelInUseError } = await import("@/lib/errors");
  const inUse = () => Promise.reject(new ChannelInUseError("email"));
  return { getEmailStatus: vi.fn(), startEmailListener: vi.fn(inUse), stopEmailListener: vi.fn(inUse) };
});

const post = (path: string, action: string) =>
  new NextRequest(`http://localhost:3000/api/channels/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });

describe("channel used by another company", () => {
  it.each([
    ["whatsapp", "connect", "WhatsApp"],
    ["whatsapp", "disconnect", "WhatsApp"],
    ["email", "connect", "email"],
    ["email", "disconnect", "email"],
  ] as const)("%s %s returns 409", async (path, action, label) => {
    const { POST } = await import(`@/app/api/channels/${path}/route`);
    const response = await POST(post(path, action), {});
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(new ChannelInUseError(label).message);
  });
});
