import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { fixtures } from "../helpers/fixtures";
import { runWithCompany } from "@/lib/tenant/context";
import { handleIncomingCall, handleSpeechInput } from "@/lib/channels/phone";

vi.mock("@/lib/customer-resolver", () => ({ resolveCustomer: vi.fn().mockResolvedValue("cust-1") }));
vi.mock("@/lib/ai/engine", () => ({
  chat: vi.fn().mockResolvedValue("Sure, happy to help."),
  createNewConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
}));

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const inCompany = (fn: () => Promise<void>) => () => runWithCompany("co-acme", fn);

function gatherAction(twiml: string): URL {
  const action = twiml.match(/<Gather[^>]* action="([^"]*)"/)?.[1];
  expect(action).toBeDefined();
  return new URL(action!.replace(/&amp;/g, "&"), "http://base.test");
}

beforeEach(() => {
  mockPrisma.company.findUnique.mockReset().mockResolvedValue({ slug: "acme" });
  mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings });
  mockPrisma.callLog.create.mockResolvedValue({});
  mockPrisma.callLog.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.conversation.findFirst.mockResolvedValue({ id: "conv-1" });
});

// twilio calls the gather url back without a login, so it has to name the company
describe("phone callbacks carry the company", () => {
  it("incoming call gather url has the company, conversation and call", inCompany(async () => {
    const url = gatherAction(await handleIncomingCall("+1555", "CA1"));
    expect(url.pathname).toBe("/api/channels/phone/gather");
    expect(url.searchParams.get("company")).toBe("acme");
    expect(url.searchParams.get("conversationId")).toBe("conv-1");
    expect(url.searchParams.get("callSid")).toBe("CA1");
    expect(mockPrisma.company.findUnique).toHaveBeenCalledWith({ where: { id: "co-acme" }, select: { slug: true } });
  }));

  it("follow-up gather after a reply keeps the company, conversation and call", inCompany(async () => {
    const url = gatherAction(await handleSpeechInput("hello", "conv-1", "CA1"));
    expect(url.searchParams.get("company")).toBe("acme");
    expect(url.searchParams.get("conversationId")).toBe("conv-1");
    expect(url.searchParams.get("callSid")).toBe("CA1");
  }));

  it("the not-configured reply still points back at this company", inCompany(async () => {
    mockPrisma.settings.upsert.mockResolvedValue({ ...fixtures.settings, twilioSid: "", twilioToken: "" });
    const url = gatherAction(await handleIncomingCall("+1555", "CA1"));
    expect(url.searchParams.get("company")).toBe("acme");
  }));

  it("escapes the url inside the TwiML attribute", inCompany(async () => {
    const twiml = await handleIncomingCall("+1555", "CA1");
    const action = twiml.match(/<Gather[^>]* action="([^"]*)"/)?.[1] ?? "";
    expect(action).not.toMatch(/&(?!amp;)/);
  }));
});
