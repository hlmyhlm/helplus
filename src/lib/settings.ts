import { prisma } from "@/lib/prisma";
import { currentCompanyId } from "@/lib/tenant/context";
import type { Prisma, Settings } from "@/generated/prisma/client";
import { SECRET_FIELDS } from "@/lib/security";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { resolveBaseUrl, toProviderKind } from "@/lib/ai/provider";
import { logger } from "@/lib/logger";

const MASK = "***";

export type SettingsInput = Partial<
  Record<Exclude<keyof Settings, "id" | "createdAt" | "updatedAt">, string | number | boolean>
>;

export interface SettingsStatus {
  settings: Settings;
  // secrets that are stored but failed to decrypt (wrong or rotated key, tampered)
  undecryptable: string[];
}

// a bad key shouldn't lock admins out of the settings page, so failed fields
// come back empty. callers that guard something must check undecryptable
function decryptRow(row: Settings): SettingsStatus {
  const settings = { ...row };
  const undecryptable: string[] = [];
  for (const field of SECRET_FIELDS) {
    try {
      settings[field] = decryptSecret(settings[field] ?? "");
    } catch {
      logger.warn(`could not decrypt settings.${field}, treating it as empty`);
      settings[field] = "";
      undecryptable.push(field);
    }
  }
  return { settings, undecryptable };
}

export async function getSettingsWithStatus(): Promise<SettingsStatus> {
  const row = await prisma.settings.upsert({
    where: { companyId: currentCompanyId() },
    update: {},
    create: {},
  });
  return decryptRow(row);
}

export async function getSettings(): Promise<Settings> {
  return (await getSettingsWithStatus()).settings;
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

export async function saveSettings(input: SettingsInput): Promise<Settings> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.settings.findUnique({ where: { companyId: currentCompanyId() } });
    const checked = dropStaleKeys(current ?? null, input);
    const data = prepareSettingsUpdate(checked) as Prisma.SettingsUpdateInput;
    const row = await tx.settings.upsert({
      where: { companyId: currentCompanyId() },
      update: data,
      create: { ...(data as Prisma.SettingsCreateInput) },
    });
    return decryptRow(row).settings;
  });
}

// re-saves every stored secret so old plain-text values get encrypted.
// refuses to run if anything fails to decrypt, so a wrong key can't wipe secrets
export async function reencryptSecrets(): Promise<number> {
  const { settings, undecryptable } = await getSettingsWithStatus();
  if (undecryptable.length > 0) {
    throw new Error(
      `can't decrypt ${undecryptable.join(", ")} with the current HELPLUS_SECRET_KEY. Nothing was written.`
    );
  }
  const secrets = Object.fromEntries(SECRET_FIELDS.filter((f) => settings[f]).map((f) => [f, settings[f]]));
  await saveSettings(secrets);
  return Object.keys(secrets).length;
}
