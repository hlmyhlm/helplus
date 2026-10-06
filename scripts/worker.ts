// background jobs: auto-close, sla alerts, email. run next to the app with npm run worker
import { runAllCompanies } from "../src/lib/jobs/run";
import { systemPrisma } from "../src/lib/prisma";
import { logger } from "../src/lib/logger";

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
  do {
    const started = Date.now();
    try {
      await runAllCompanies(new Date());
    } catch (error) {
      logger.error("worker run failed", error);
    }
    if (once) break;
    const wait = Math.max(0, EVERY_MS - (Date.now() - started));
    for (let waited = 0; waited < wait && !stopping; waited += 1000) await new Promise((r) => setTimeout(r, 1000));
  } while (!stopping);
  await systemPrisma.$disconnect();
}

main();
