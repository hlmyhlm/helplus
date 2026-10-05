import { describe, it, expect, vi, beforeEach } from "vitest";
import { systemPrisma } from "@/lib/prisma";
import { resolveWebhookCompany } from "@/lib/tenant/webhook-company";

const company = (systemPrisma as unknown as { company: Record<string, ReturnType<typeof vi.fn>> }).company;
const req = (url: string) => ({ nextUrl: new URL(url) }) as never;

beforeEach(() => {
  company.findUnique.mockReset();
  company.findMany.mockReset();
});

describe("resolveWebhookCompany", () => {
  it("uses ?company=<slug> when given", async () => {
    company.findUnique.mockResolvedValue({ id: "co-7" });
    expect(await resolveWebhookCompany(req("http://x/api/channels/sms?company=acme"))).toBe("co-7");
    expect(company.findUnique).toHaveBeenCalledWith({ where: { slug: "acme" }, select: { id: true } });
  });

  it("returns null for an unknown slug", async () => {
    company.findUnique.mockResolvedValue(null);
    expect(await resolveWebhookCompany(req("http://x/api/channels/sms?company=nope"))).toBeNull();
  });

  it("falls back to the only company when there is exactly one", async () => {
    company.findMany.mockResolvedValue([{ id: "only" }]);
    expect(await resolveWebhookCompany(req("http://x/api/channels/sms"))).toBe("only");
  });

  it("refuses to guess when there are several companies", async () => {
    company.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    expect(await resolveWebhookCompany(req("http://x/api/channels/sms"))).toBeNull();
  });
});
