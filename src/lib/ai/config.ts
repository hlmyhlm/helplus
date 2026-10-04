import type { Settings } from "@/generated/prisma/client";
import { toProviderKind, type ProviderConfig } from "./provider";

type ChatFields = Pick<Settings, "aiProvider" | "aiModel" | "aiApiKey" | "aiBaseUrl">;
type EmbedFields = ChatFields & Pick<Settings, "embedProvider" | "embedModel" | "embedApiKey" | "embedBaseUrl">;

export function chatConfig(s: ChatFields): ProviderConfig {
  return { kind: toProviderKind(s.aiProvider), model: s.aiModel, apiKey: s.aiApiKey, baseUrl: s.aiBaseUrl };
}

export function embedConfig(s: EmbedFields): ProviderConfig {
  const kind = toProviderKind(s.embedProvider);
  // same provider as chat and no separate key: reuse the chat key
  const apiKey = s.embedApiKey || (kind === toProviderKind(s.aiProvider) ? s.aiApiKey : "");
  return { kind, model: s.embedModel, apiKey, baseUrl: s.embedBaseUrl };
}

export function isConfigured(cfg: ProviderConfig): boolean {
  return cfg.kind === "ollama" || cfg.kind === "custom" || cfg.apiKey.length > 0;
}
