// run next to the app: npm run worker
import { runAllCompanies } from "../src/lib/jobs/run";
import { systemPrisma } from "../src/lib/prisma";
import { logger } from "../src/lib/logger";
import { closeOcr } from "../src/lib/ocr/tesseract";

const EVERY_MS = 60_000;
let stopping = false;
const stop = () => {
  stopping = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function main() {
  const once = process.argv.includes("--once");
  logger.info(once ? "worker: one run" : "worker: started");
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
  // the ocr worker thread keeps node alive otherwise
  await closeOcr();
  await systemPrisma.$disconnect();
  if (once && threw) process.exitCode = 1;
}

main().catch((error) => {
  logger.error("worker crashed", error);
  process.exit(1);
});
