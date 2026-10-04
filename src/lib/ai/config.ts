import type { Settings } from "@/generated/prisma/client";
import { toProviderKind, resolveBaseUrl, type ProviderConfig } from "./provider";

type ChatFields = Pick<Settings, "aiProvider" | "aiModel" | "aiApiKey" | "aiBaseUrl">;
type EmbedFields = ChatFields & Pick<Settings, "embedProvider" | "embedModel" | "embedApiKey" | "embedBaseUrl">;

export function chatConfig(s: ChatFields): ProviderConfig {
  return { kind: toProviderKind(s.aiProvider), model: s.aiModel, apiKey: s.aiApiKey, baseUrl: s.aiBaseUrl };
}

export function embedConfig(s: EmbedFields): ProviderConfig {
  const kind = toProviderKind(s.embedProvider);
  const chat = chatConfig(s);
  const embedBaseUrl = resolveBaseUrl({ kind, model: s.embedModel, apiKey: "", baseUrl: s.embedBaseUrl });
  // only hand the chat key to a provider that resolves to the same server
  const sameServer = kind === chat.kind && embedBaseUrl === resolveBaseUrl(chat);
  const apiKey = s.embedApiKey || (sameServer ? chat.apiKey : "");
  return { kind, model: s.embedModel, apiKey, baseUrl: s.embedBaseUrl };
}

export function isConfigured(cfg: ProviderConfig): boolean {
  return cfg.kind === "ollama" || cfg.kind === "custom" || cfg.apiKey.length > 0;
}
