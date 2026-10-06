import OpenAI from "openai";
import { maskIC } from "@/lib/privacy/ic-mask";

export type ProviderKind = "openai" | "deepseek" | "ollama" | "custom";

export interface ProviderConfig {
  kind: ProviderKind;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export type ChatMessage = OpenAI.ChatCompletionMessageParam;

export interface ChatOptions {
  messages: ChatMessage[];
  tools?: OpenAI.ChatCompletionTool[];
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_BASE_URL: Record<ProviderKind, string | undefined> = {
  openai: undefined,
  deepseek: "https://api.deepseek.com",
  ollama: "http://localhost:11434/v1",
  custom: undefined,
};

export function toProviderKind(value: string): ProviderKind {
  return value === "deepseek" || value === "ollama" || value === "custom" ? value : "openai";
}

export function resolveBaseUrl(cfg: ProviderConfig): string | undefined {
  return cfg.baseUrl?.trim() || DEFAULT_BASE_URL[cfg.kind];
}

function createClient(cfg: ProviderConfig): OpenAI {
  const baseURL = resolveBaseUrl(cfg);
  if (cfg.kind === "custom" && !baseURL) {
    throw new Error("custom provider needs a base URL");
  }
  // local servers ignore the key, but the sdk refuses an empty one
  return new OpenAI({ apiKey: cfg.apiKey || "local", baseURL });
}

export function maskMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { ...m, content: maskIC(m.content).text } as ChatMessage;
    }
    if (Array.isArray(m.content)) {
      const parts = (m.content as Array<{ type: string; text?: string }>).map((p) =>
        p.type === "text" && typeof p.text === "string" ? { ...p, text: maskIC(p.text).text } : p
      );
      return { ...m, content: parts } as ChatMessage;
    }
    return m;
  });
}

export async function chatCompletion(cfg: ProviderConfig, opts: ChatOptions): Promise<OpenAI.ChatCompletion> {
  const client = createClient(cfg);
  return client.chat.completions.create({
    model: cfg.model,
    messages: maskMessages(opts.messages),
    tools: opts.tools?.length ? opts.tools : undefined,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    stream: false,
  });
}

export async function embed(cfg: ProviderConfig, texts: string[]): Promise<number[][]> {
  const client = createClient(cfg);
  const res = await client.embeddings.create({
    model: cfg.model,
    input: texts.map((t) => maskIC(t).text.slice(0, 8000)),
  });
  return res.data.map((d) => d.embedding as number[]);
}
