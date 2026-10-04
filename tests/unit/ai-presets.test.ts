import { describe, it, expect } from "vitest";
import { aiLooksConfigured } from "@/lib/ai/presets";

// the settings api masks keys as "***", so that's what the checklist sees
describe("aiLooksConfigured", () => {
  it("needs a key for hosted providers", () => {
    expect(aiLooksConfigured({ aiProvider: "openai", aiApiKey: "***", aiBaseUrl: "" })).toBe(true);
    expect(aiLooksConfigured({ aiProvider: "deepseek", aiApiKey: "", aiBaseUrl: "" })).toBe(false);
  });

  it("counts ollama without a key", () => {
    expect(aiLooksConfigured({ aiProvider: "ollama", aiApiKey: "", aiBaseUrl: "" })).toBe(true);
  });

  it("needs a server url for a custom provider", () => {
    expect(aiLooksConfigured({ aiProvider: "custom", aiApiKey: "", aiBaseUrl: "http://llm.local/v1" })).toBe(true);
    expect(aiLooksConfigured({ aiProvider: "custom", aiApiKey: "***", aiBaseUrl: " " })).toBe(false);
  });

  it("handles a missing settings response", () => {
    expect(aiLooksConfigured({})).toBe(false);
  });
});
