// runs before any test file imports prisma, so the client connects to the test database
try {
  (process as { loadEnvFile?: () => void }).loadEnvFile?.();
} catch {
  // no .env, rely on the environment
}

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is not set. Point it at an empty database, the tests wipe it.");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.HELPLUS_SECRET_KEY ||= "b2".repeat(32);
