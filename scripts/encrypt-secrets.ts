// re-saves every secret so values stored as plain text get encrypted.
// run once after deploying: npx tsx --env-file=.env scripts/encrypt-secrets.ts
import { reencryptSecrets } from "../src/lib/settings";

reencryptSecrets()
  .then((count) => {
    console.log(`encrypted ${count} fields`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
