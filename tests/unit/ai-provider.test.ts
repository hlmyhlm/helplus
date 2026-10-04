import { describe, it, expect, vi, beforeEach } from "vitest";

const created: { apiKey?: string; baseURL?: string }[] = [];
const chatCreate = vi.fn();
const embedCreate = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: chatCreate } };
    embeddings = { create: embedCreate };
    constructor(opts: { apiKey?: string; baseURL?: string }) {
      created.push(opts);
    }
  },
}));

import { chatCompletion, embed, resolveBaseUrl, toProviderKind, maskMessages } from "@/lib/ai/provider";
import { chatConfig, embedConfig, isConfigured } from "@/lib/ai/config";
import { fixtures } from "../helpers/fixtures";

beforeEach(() => {
  created.length = 0;
  chatCreate.mockReset().mockResolvedValue({ choices: [{ message: { content: "ok" } }] });
  embedCreate.mockReset().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] });
});

describe("provider", () => {
  it("uses the default base url per provider", () => {
    expect(resolveBaseUrl({ kind: "openai", model: "m", apiKey: "k" })).toBeUndefined();
    expect(resolveBaseUrl({ kind: "deepseek", model: "m", apiKey: "k" })).toBe("https://api.deepseek.com");
    expect(resolveBaseUrl({ kind: "ollama", model: "m", apiKey: "" })).toBe("http://localhost:11434/v1");
  });

  it("lets a custom base url win", () => {
    expect(resolveBaseUrl({ kind: "ollama", model: "m", apiKey: "", baseUrl: "http://gpu-box:11434/v1" })).toBe(
      "http://gpu-box:11434/v1"
    );
  });

  it("maps unknown provider names to openai", () => {
    expect(toProviderKind("claude")).toBe("openai");
    expect(toProviderKind("deepseek")).toBe("deepseek");
  });

  it("masks IC numbers before sending a chat", async () => {
    await chatCompletion(
      { kind: "deepseek", model: "deepseek-chat", apiKey: "k" },
      { messages: [{ role: "user", content: "IC saya 900101-14-5678" }] }
    );
    const sent = chatCreate.mock.calls[0][0];
    expect(sent.messages[0].content).toBe("IC saya [IC HIDDEN]");
    expect(sent.model).toBe("deepseek-chat");
    expect(created[0].baseURL).toBe("https://api.deepseek.com");
  });

  it("masks text parts of multi-part messages", () => {
    const out = maskMessages([
      { role: "user", content: [{ type: "text", text: "ic 900101145678" }] },
    ]);
    expect(out[0].content).toEqual([{ type: "text", text: "ic [IC HIDDEN]" }]);
  });

  it("gives local servers a dummy key", async () => {
    await chatCompletion({ kind: "ollama", model: "llama3.1", apiKey: "" }, { messages: [] });
    expect(created[0].apiKey).toBe("local");
  });

  it("refuses a custom provider without a url", async () => {
    await expect(
      chatCompletion({ kind: "custom", model: "x", apiKey: "" }, { messages: [] })
    ).rejects.toThrow(/base URL/);
  });

  it("masks and returns embeddings", async () => {
    const out = await embed({ kind: "openai", model: "text-embedding-3-small", apiKey: "k" }, ["ic 900101145678"]);
    expect(embedCreate.mock.calls[0][0].input).toEqual(["ic [IC HIDDEN]"]);
    expect(out).toEqual([[0.1, 0.2]]);
  });
});

describe("config", () => {
  it("builds the chat config from settings", () => {
    const cfg = chatConfig({ ...fixtures.settings, aiProvider: "deepseek", aiModel: "deepseek-chat" });
    expect(cfg).toEqual({ kind: "deepseek", model: "deepseek-chat", apiKey: "sk-test-key-12345", baseUrl: "" });
  });

  it("reuses the chat key for embeddings on the same provider", () => {
    const cfg = embedConfig({ ...fixtures.settings, embedApiKey: "" });
    expect(cfg.apiKey).toBe("sk-test-key-12345");
  });

  it("does not reuse the chat key across providers", () => {
    const cfg = embedConfig({ ...fixtures.settings, aiProvider: "deepseek", embedApiKey: "" });
    expect(cfg.apiKey).toBe("");
  });

  it("treats local providers as configured without a key", () => {
    expect(isConfigured({ kind: "ollama", model: "m", apiKey: "" })).toBe(true);
    expect(isConfigured({ kind: "openai", model: "m", apiKey: "" })).toBe(false);
  });
});
