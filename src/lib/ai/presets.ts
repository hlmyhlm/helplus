export interface ProviderPreset {
  value: string;
  label: string;
  model: string;
  baseUrl: string;
}

export const AI_PROVIDERS: ProviderPreset[] = [
  { value: "openai", label: "OpenAI (ChatGPT)", model: "gpt-4o-mini", baseUrl: "" },
  { value: "deepseek", label: "DeepSeek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com" },
  { value: "ollama", label: "Ollama (local)", model: "llama3.1", baseUrl: "http://localhost:11434/v1" },
  { value: "custom", label: "Other OpenAI-compatible server", model: "", baseUrl: "" },
];

export const EMBED_PROVIDERS: ProviderPreset[] = [
  { value: "openai", label: "OpenAI", model: "text-embedding-3-small", baseUrl: "" },
  { value: "ollama", label: "Ollama (local)", model: "nomic-embed-text", baseUrl: "http://localhost:11434/v1" },
  { value: "custom", label: "Other OpenAI-compatible server", model: "", baseUrl: "" },
];

export function findPreset(list: ProviderPreset[], value: string): ProviderPreset | undefined {
  return list.find((p) => p.value === value);
}

// local and self-hosted servers usually don't need a key
export function isLocalProvider(value: string): boolean {
  return value === "ollama" || value === "custom";
}
