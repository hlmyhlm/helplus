import { prisma } from "@/lib/prisma";
import type { Prisma, Settings } from "@/generated/prisma/client";
import { SECRET_FIELDS } from "@/lib/security";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

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

export async function saveSettings(input: Prisma.SettingsUpdateInput): Promise<Settings> {
  const data = prepareSettingsUpdate(input as Record<string, unknown>) as Prisma.SettingsUpdateInput;
  const row = await prisma.settings.upsert({
    where: { id: "default" },
    update: data,
    create: { id: "default", ...(data as Prisma.SettingsCreateInput) },
  });
  return decryptRow(row);
}
