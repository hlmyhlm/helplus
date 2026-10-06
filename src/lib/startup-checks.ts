// a well-formed but wrong key passes the format check, so try the stored secrets too
export async function checkStoredSecrets(): Promise<void> {
  const { logger } = await import("@/lib/logger");
  try {
    const { getSettingsWithStatus } = await import("@/lib/settings");
    const { systemPrisma } = await import("@/lib/prisma");
    const { runWithCompany } = await import("@/lib/tenant/context");
    const companies = await systemPrisma.company.findMany({ select: { id: true, slug: true } });
    for (const c of companies) {
      const { undecryptable } = await runWithCompany(c.id, getSettingsWithStatus);
      if (undecryptable.length > 0) {
        logger.error(
          `company ${c.slug}: HELPLUS_SECRET_KEY can't decrypt stored ${undecryptable.join(", ")}. Check the key or re-enter these in Settings.`
        );
      }
    }
  } catch (error) {
    logger.warn("couldn't check stored secrets at startup", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
