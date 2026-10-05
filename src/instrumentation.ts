export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // fail fast instead of erroring on the first settings save. skipped during next build
    if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
      const { assertSecretKey } = await import("@/lib/secrets");
      try {
        assertSecretKey();
      } catch {
        throw new Error("HELPLUS_SECRET_KEY is missing or invalid. Set it to 64 hex characters (see .env.example).");
      }
      // not awaited, so a slow or missing database doesn't hold up startup
      void checkStoredSecrets();
    }
    const { registerShutdownHandlers } = await import("@/lib/shutdown");
    registerShutdownHandlers();
  }
}

// a well-formed but wrong key passes the format check, so try the stored secrets too
export async function checkStoredSecrets(): Promise<void> {
  const { logger } = await import("@/lib/logger");
  try {
    const { getSettingsWithStatus } = await import("@/lib/settings");
    const { undecryptable } = await getSettingsWithStatus();
    if (undecryptable.length > 0) {
      logger.error(
        `HELPLUS_SECRET_KEY can't decrypt stored ${undecryptable.join(", ")}. Check the key or re-enter these in Settings.`
      );
    }
  } catch (error) {
    logger.warn("couldn't check stored secrets at startup", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
