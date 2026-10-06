// re-saves every secret so values stored as plain text get encrypted.
// run once after deploying: npx tsx --env-file=.env scripts/encrypt-secrets.ts
import { reencryptSecrets } from "../src/lib/settings";
import { systemPrisma } from "../src/lib/prisma";
import { runWithCompany } from "../src/lib/tenant/context";

async function main() {
  const companies = await systemPrisma.company.findMany({ select: { id: true, slug: true } });
  for (const c of companies) {
    const count = await runWithCompany(c.id, () => reencryptSecrets());
    console.log(`${c.slug}: encrypted ${count} fields`);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
