import { prisma } from "@/lib/prisma";
import type { Prisma, Settings } from "@/generated/prisma/client";
import { SECRET_FIELDS } from "@/lib/security";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { resolveBaseUrl, toProviderKind } from "@/lib/ai/provider";

const MASK = "***";

function decryptRow(row: Settings): Settings {
  const out = { ...row };
  for (const field of SECRET_FIELDS) {
    out[field] = decryptSecret(out[field] ?? "");
  }
  return out;
}

export async function getSettings(): Promise<Settings> {
  const row =
    (await prisma.settings.findUnique({ where: { id: "default" } })) ??
    (await prisma.settings.create({ data: { id: "default" } }));
  return decryptRow(row);
}

// the settings page posts "***" back for secrets it never saw, so skip those
export function prepareSettingsUpdate(input: Record<string, unknown>): Record<string, unknown> {
  const out = { ...input };
  for (const field of SECRET_FIELDS) {
    const value = out[field];
    if (value === MASK) delete out[field];
    else if (typeof value === "string") out[field] = encryptSecret(value);
  }
  return out;
}

type Endpoint = { provider: string; baseUrl: string | undefined };

function endpoint(provider: string, baseUrl: string): Endpoint {
  return { provider, baseUrl: resolveBaseUrl({ kind: toProviderKind(provider), model: "", apiKey: "", baseUrl }) };
}

function hasNewKey(value: unknown): boolean {
  return typeof value === "string" && value !== "" && value !== MASK;
}

// a stored key belongs to one provider and server; don't send it anywhere else
function dropStaleKeys(current: Settings | null, input: Record<string, unknown>): Record<string, unknown> {
  if (!current) return input;
  const out = { ...input };
  const pick = (field: keyof Settings) => (typeof input[field] === "string" ? (input[field] as string) : (current[field] as string));
  const pairs = [
    { key: "aiApiKey", provider: "aiProvider", url: "aiBaseUrl" },
    { key: "embedApiKey", provider: "embedProvider", url: "embedBaseUrl" },
  ] as const;
  for (const { key, provider, url } of pairs) {
    const before = endpoint(current[provider], current[url]);
    const after = endpoint(pick(provider), pick(url));
    const moved = before.provider !== after.provider || before.baseUrl !== after.baseUrl;
    if (moved && !hasNewKey(input[key])) out[key] = "";
  }
  return out;
}

export async function saveSettings(input: Prisma.SettingsUpdateInput): Promise<Settings> {
  const current = await prisma.settings.findUnique({ where: { id: "default" } });
  const checked = dropStaleKeys(current ?? null, input as Record<string, unknown>);
  const data = prepareSettingsUpdate(checked) as Prisma.SettingsUpdateInput;
  const row = await prisma.settings.upsert({
    where: { id: "default" },
    update: data,
    create: { id: "default", ...(data as Prisma.SettingsCreateInput) },
  });
  return decryptRow(row);
}
