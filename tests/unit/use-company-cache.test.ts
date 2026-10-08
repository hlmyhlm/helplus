import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { companyCache, clearCompanyCache, subscribeCompany, useCompany } from "@/lib/hooks/use-company";

const INFO = {
  name: "Acme",
  slug: "acme",
  projectLabel: "Clients",
  canManageProjects: true,
  canCheckScreens: true,
  canUpdateTickets: true,
  canImport: true,
  autoCloseDays: 3,
};

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => clearCompanyCache());
afterEach(() => vi.unstubAllGlobals());

describe("company cache", () => {
  it("clears so the next useCompany call fetches again", () => {
    companyCache.value = { ...INFO, loaded: true, failed: false };
    clearCompanyCache();
    expect(companyCache.value).toBeNull();
  });

  it("tells subscribers when it's cleared", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    companyCache.value = { ...INFO, loaded: true, failed: false };
    const listener = vi.fn();
    const stop = subscribeCompany(listener);
    clearCompanyCache();
    expect(listener).toHaveBeenCalled();
    stop();
  });
});

describe("useCompany", () => {
  it("renders the empty info on the server even with a filled cache", () => {
    companyCache.value = { ...INFO, loaded: true, failed: false };
    function Probe() {
      const c = useCompany();
      return createElement("span", null, `${c.loaded}|${c.canImport}|${c.name}`);
    }
    expect(renderToString(createElement(Probe))).toContain("false|false|");
  });

  it("shares one fetch between two subscribers", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => INFO }));
    vi.stubGlobal("fetch", fetchMock);
    const a = vi.fn();
    const b = vi.fn();
    const stopA = subscribeCompany(a);
    const stopB = subscribeCompany(b);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    expect(companyCache.value).toMatchObject({ name: "Acme", loaded: true, failed: false });
    stopA();
    stopB();
  });

  it("marks a failed fetch so pages can say so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const stop = subscribeCompany(() => {});
    await flush();
    expect(companyCache.value).toBeNull();
    function Probe() {
      return createElement("span", null, String(useCompany().failed));
    }
    // the server snapshot never reports a failure
    expect(renderToString(createElement(Probe))).toContain("false");
    const { companySnapshot } = await import("@/lib/hooks/use-company");
    expect(companySnapshot().failed).toBe(true);
    stop();
  });
});
