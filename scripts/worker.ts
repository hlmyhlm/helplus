// run next to the app: npm run worker
import { runAllCompanies } from "../src/lib/jobs/run";
import { systemPrisma } from "../src/lib/prisma";
import { logger } from "../src/lib/logger";
import { closeOcr } from "../src/lib/ocr/tesseract";
import { syncBots, stopAllBots } from "../src/lib/bot/runtime";

const EVERY_MS = 60_000;
const BOT_SYNC_MS = 5_000;
let stopping = false;
const stop = () => {
  stopping = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// a stray promise from a whatsapp client shouldn't kill the worker
process.on("unhandledRejection", (error) => logger.error("unhandled rejection in worker", error));

async function main() {
  const once = process.argv.includes("--once");
  logger.info(once ? "worker: one run" : "worker: started");
  // the whatsapp bot needs a long-running worker, so --once leaves it alone
  let syncing = false;
  const botTimer = once
    ? null
    : setInterval(() => {
        if (syncing || stopping) return;
        syncing = true;
        syncBots(new Date())
          .catch((error) => logger.error("bot sync failed", error))
          .finally(() => {
            syncing = false;
          });
      }, BOT_SYNC_MS);
  let threw = false;
  do {
    const started = Date.now();
    try {
      await runAllCompanies(new Date(), () => stopping);
    } catch (error) {
      logger.error("worker run failed", error);
      threw = true;
    }
    if (once) break;
    const wait = Math.max(0, EVERY_MS - (Date.now() - started));
    for (let waited = 0; waited < wait && !stopping; waited += 1000) await new Promise((r) => setTimeout(r, 1000));
  } while (!stopping);
  if (botTimer) clearInterval(botTimer);
  while (syncing) await new Promise((r) => setTimeout(r, 200));
  await stopAllBots();
  // the ocr worker thread keeps node alive otherwise
  await closeOcr();
  await systemPrisma.$disconnect();
  if (once && threw) process.exitCode = 1;
}

main().catch((error) => {
  logger.error("worker crashed", error);
  process.exit(1);
});
