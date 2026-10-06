import { describe, it, expect } from "vitest";
import {
  mainNav,
  phoneTabs,
  sectionGroups,
  isActive,
  groupFor,
  activeHref,
  moreActive,
} from "@/components/layout/nav-items";

const item = (name: string) => mainNav.find((i) => i.name === name)!;

describe("isActive", () => {
  it("matches the dashboard only on / and analytics", () => {
    expect(isActive("/", item("Dashboard"))).toBe(true);
    expect(isActive("/analytics", item("Dashboard"))).toBe(true);
    expect(isActive("/tickets", item("Dashboard"))).toBe(false);
  });

  it("matches sub-paths but not look-alike paths", () => {
    expect(isActive("/tickets/42", item("Tickets"))).toBe(true);
    expect(isActive("/ticketsx", item("Tickets"))).toBe(false);
  });

  it("keeps settings active on the old system pages", () => {
    for (const p of ["/settings", "/team", "/sla", "/webhooks", "/admin", "/activity", "/api-docs"]) {
      expect(isActive(p, item("Settings"))).toBe(true);
    }
  });

  it("keeps library active on saved replies and the AI test page", () => {
    expect(isActive("/canned-responses", item("Library"))).toBe(true);
    expect(isActive("/knowledge/test", item("Library"))).toBe(true);
  });
});

describe("section groups", () => {
  it("finds the group for a page", () => {
    expect(groupFor("/sla")?.name).toBe("Settings");
    expect(groupFor("/canned-responses")?.name).toBe("Library");
    expect(groupFor("/")?.name).toBe("Dashboard");
    expect(groupFor("/tickets")).toBeNull();
  });

  it("picks the most specific tab", () => {
    const library = sectionGroups.find((g) => g.name === "Library")!;
    expect(activeHref(library, "/knowledge/test")).toBe("/knowledge/test");
    expect(activeHref(library, "/knowledge")).toBe("/knowledge");
  });
});

describe("phone nav", () => {
  it("shows four tabs plus More", () => {
    expect(phoneTabs.map((i) => i.name)).toEqual(["Dashboard", "Tickets", "Clients", "Library"]);
  });

  it("lights up More for pages that live behind it", () => {
    expect(moreActive("/more")).toBe(true);
    expect(moreActive("/channels")).toBe(true);
    expect(moreActive("/team")).toBe(true);
    expect(moreActive("/tickets")).toBe(false);
  });
});

describe("clients group", () => {
  it("finds the clients group for a customer page", () => {
    expect(groupFor("/customers")?.name).toBe("Clients");
  });
});
