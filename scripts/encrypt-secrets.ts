// re-saves every secret so values stored as plain text get encrypted.
// run once after deploying: npx tsx --env-file=.env scripts/encrypt-secrets.ts
import { getSettings, saveSettings } from "../src/lib/settings";
import { SECRET_FIELDS } from "../src/lib/security";

async function main() {
  const settings = await getSettings();
  // skip empty ones, which includes any value that failed to decrypt
  const secrets = Object.fromEntries(SECRET_FIELDS.filter((f) => settings[f]).map((f) => [f, settings[f]]));
  await saveSettings(secrets);
  console.log(`encrypted ${Object.keys(secrets).length} fields`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
