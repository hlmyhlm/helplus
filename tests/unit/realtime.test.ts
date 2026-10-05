import { describe, it, expect, vi, beforeEach } from "vitest";

// Use actual realtime module (not mocked) for unit tests
vi.unmock("@/lib/realtime");

describe("Real-time Event System", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should subscribe and receive published events", async () => {
    const { subscribe, publish } = await import("@/lib/realtime");
    const { runWithCompany } = await import("@/lib/tenant/context");
    const callback = vi.fn();

    runWithCompany("test-company", () => {
      const unsubscribe = subscribe("test-channel", callback);
      publish("test-channel", { type: "message:new", data: { id: "msg-1" } });
      unsubscribe();
    });

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ type: "message:new", data: { id: "msg-1" } })
    );
  });

  it("should not receive events after unsubscribe", async () => {
    const { subscribe, publish } = await import("@/lib/realtime");
    const { runWithCompany } = await import("@/lib/tenant/context");
    const callback = vi.fn();

    runWithCompany("test-company", () => {
      const unsubscribe = subscribe("test-ch", callback);
      unsubscribe();
      publish("test-ch", { type: "message:new", data: {} });
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it("should publish to global channel as well", async () => {
    const { subscribe, publish } = await import("@/lib/realtime");
    const { runWithCompany } = await import("@/lib/tenant/context");
    const globalCb = vi.fn();

    runWithCompany("test-company", () => {
      const unsub = subscribe("global", globalCb);
      publish("specific-channel", { type: "conversation:new", data: {} });
      unsub();
    });

    expect(globalCb).toHaveBeenCalledWith(
      expect.objectContaining({ type: "conversation:new" })
    );
  });

  it("should include timestamp in events", async () => {
    const { subscribe, publish } = await import("@/lib/realtime");
    const { runWithCompany } = await import("@/lib/tenant/context");
    const callback = vi.fn();

    runWithCompany("test-company", () => {
      const unsub = subscribe("ts-test", callback);
      publish("ts-test", { type: "notification", data: {} });
      unsub();
    });

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: expect.any(String) })
    );
  });

  it("should track subscriber count", async () => {
    const { subscribe, getSubscriberCount } = await import("@/lib/realtime");
    const { runWithCompany } = await import("@/lib/tenant/context");

    runWithCompany("test-company", () => {
      const unsub1 = subscribe("ch1", vi.fn());
      const unsub2 = subscribe("ch2", vi.fn());

      expect(getSubscriberCount()).toBeGreaterThanOrEqual(2);

      unsub1();
      unsub2();
    });
  });

  it("keeps companies' events apart", async () => {
    const { subscribe, publish } = await import("@/lib/realtime");
    const { runWithCompany } = await import("@/lib/tenant/context");
    const got: string[] = [];

    runWithCompany("a", () => subscribe("global", () => got.push("a")));
    runWithCompany("b", () => subscribe("global", () => got.push("b")));
    runWithCompany("a", () => publish("global", { type: "notification", data: {} }));

    expect(got).toEqual(["a"]);
  });

  it("refuses to publish or subscribe outside any company context", async () => {
    const { subscribe, publish } = await import("@/lib/realtime");
    const { MissingCompanyError } = await import("@/lib/tenant/context");

    expect(() => subscribe("no-context-channel", vi.fn())).toThrow(MissingCompanyError);
    expect(() => publish("no-context-channel", { type: "notification", data: {} })).toThrow(MissingCompanyError);
  });
});
