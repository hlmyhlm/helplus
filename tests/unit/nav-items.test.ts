import { describe, it, expect } from "vitest";
import {
  mainNav,
  phoneTabs,
  sectionGroups,
  isActive,
  groupFor,
  activeHref,
  moreActive,
  visibleItems,
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
    for (const p of ["/settings", "/privacy", "/team", "/sla", "/webhooks", "/admin", "/activity", "/api-docs"]) {
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

describe("sources group", () => {
  const sources = () => sectionGroups.find((g) => g.name === "Sources")!;

  it("holds channels and imports", () => {
    expect(sources().items.map((i) => i.href)).toEqual(["/channels", "/imports"]);
    expect(groupFor("/imports")?.name).toBe("Sources");
    expect(groupFor("/imports/abc")?.name).toBe("Sources");
  });

  it("keeps the sources item on channels and lights it on imports", () => {
    expect(item("Sources").href).toBe("/channels");
    expect(isActive("/channels", item("Sources"))).toBe(true);
    expect(isActive("/imports/abc", item("Sources"))).toBe(true);
    expect(moreActive("/imports")).toBe(true);
  });

  it("hides imports from roles without imports:run", () => {
    const yes = visibleItems(sources(), () => true);
    const no = visibleItems(sources(), (p) => p !== "imports:run");
    expect(yes.map((i) => i.name)).toEqual(["Channels", "Imports"]);
    expect(no.map((i) => i.name)).toEqual(["Channels"]);
  });
});

describe("library drafts", () => {
  it("puts waiting approval right after articles", () => {
    const library = sectionGroups.find((g) => g.name === "Library")!;
    expect(library.items.map((i) => i.name).slice(0, 2)).toEqual(["Articles", "Waiting approval"]);
    expect(library.items[1]).toMatchObject({ href: "/knowledge/drafts", permission: "knowledge:read" });
    expect(activeHref(library, "/knowledge/drafts")).toBe("/knowledge/drafts");
    expect(isActive("/knowledge/drafts", item("Library"))).toBe(true);
  });
});
