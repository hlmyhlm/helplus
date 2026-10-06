// imported first by seed.ts so .env is loaded before src/lib/prisma reads DATABASE_URL.
// when run by hand; in docker the vars are already set
try {
  (process as { loadEnvFile?: () => void }).loadEnvFile?.();
} catch {
  // no .env file, that's fine
}
