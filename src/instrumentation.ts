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
      // not awaited, so a slow or missing database doesn't hold up startup.
      // lives in its own file so the edge bundle doesn't pull in prisma
      const { checkStoredSecrets } = await import("@/lib/startup-checks");
      void checkStoredSecrets();
    }
    const { registerShutdownHandlers } = await import("@/lib/shutdown");
    registerShutdownHandlers();
  }
}
