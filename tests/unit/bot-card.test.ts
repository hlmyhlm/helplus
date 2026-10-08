import { describe, it, expect } from "vitest";
import { botLabel } from "@/app/(dashboard)/channels/bot-label";

describe("botLabel", () => {
  it("shows a stale worker as red", () => {
    expect(botLabel({ status: "connected", stale: true, phone: "60111", error: "" })).toEqual({ text: "Worker not running", tone: "danger" });
  });
  it("shows the bot number when connected", () => {
    expect(botLabel({ status: "connected", stale: false, phone: "60111", error: "" })).toEqual({ text: "Connected as +60111", tone: "success" });
  });
  it("adds the error to a disconnect", () => {
    expect(botLabel({ status: "disconnected", stale: false, phone: "", error: "WhatsApp disconnected." }).text).toBe("Disconnected. WhatsApp disconnected.");
  });
  it("adds the error when it is off", () => {
    expect(botLabel({ status: "off", stale: false, phone: "", error: "Couldn't start WhatsApp" })).toEqual({ text: "Not connected. Couldn't start WhatsApp", tone: "muted" });
  });
  it("covers the other states", () => {
    const at = (status: string) => botLabel({ status, stale: false, phone: "", error: "" });
    expect(at("qr")).toEqual({ text: "Scan the QR code", tone: "warning" });
    expect(at("starting")).toEqual({ text: "Starting…", tone: "muted" });
    expect(at("stopping")).toEqual({ text: "Stopping…", tone: "muted" });
    expect(at("disconnected")).toEqual({ text: "Disconnected", tone: "danger" });
    expect(at("off")).toEqual({ text: "Not connected", tone: "muted" });
  });
});
