import { describe, it, expect } from "vitest";
import { statusTone, sourceLabel } from "@/components/tickets/status-dot";

describe("ticket ui helpers", () => {
  it("gives every status a dot colour", () => {
    for (const s of ["new", "ai_suggested", "answered", "reopened", "working", "closed"]) {
      expect(statusTone(s)).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("names the sources", () => {
    expect(sourceLabel("whatsapp")).toBe("WhatsApp");
    expect(sourceLabel("quick_add")).toBe("Quick add");
    expect(sourceLabel("whatsapp_export")).toBe("WhatsApp export");
    expect(sourceLabel("old_system")).toBe("Old system");
    expect(sourceLabel("something_new")).toBe("Something new");
  });
});
