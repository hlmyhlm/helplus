import { describe, it, expect, beforeEach } from "vitest";
import { buildEmail } from "@/lib/notify/templates";

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://help.example.com/";
});

const t = { id: "t1", number: 42 };

describe("buildEmail", () => {
  it("staff emails carry a link and nothing else about the ticket", () => {
    const e = buildEmail("sla_breach", t, { companyName: "Acme" });
    expect(e.subject).toBe("Ticket #42 is overdue");
    expect(e.body).toContain("https://help.example.com/tickets/t1");
  });

  it("covers every staff kind", () => {
    for (const kind of ["new_ticket", "reopened", "sla_warning", "sla_breach"] as const) {
      expect(buildEmail(kind, t, { companyName: "Acme" }).body).toContain("/tickets/t1");
    }
  });

  it("the client warning has no link", () => {
    const e = buildEmail("close_warning", t, { companyName: "Acme", days: 3 });
    expect(e.subject).toBe("Your ticket #42 closes tomorrow");
    expect(e.body).not.toContain("http");
    expect(e.body).toContain("Acme");
  });
});
