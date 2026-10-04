// re-saves every secret so values stored as plain text get encrypted.
// run once after deploying: npx tsx --env-file=.env scripts/encrypt-secrets.ts
import { getSettings, saveSettings } from "../src/lib/settings";
import { SECRET_FIELDS } from "../src/lib/security";

const settings = await getSettings();
const secrets = Object.fromEntries(SECRET_FIELDS.map((f) => [f, settings[f]]));
await saveSettings(secrets);
console.log(`encrypted ${SECRET_FIELDS.length} fields`);
process.exit(0);
