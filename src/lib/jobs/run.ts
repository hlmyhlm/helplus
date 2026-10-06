import { systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { logger } from "@/lib/logger";
import { drainOutbox } from "@/lib/notify/outbox";
import { runAutoClose } from "./auto-close";
import { runSlaAlerts } from "./sla-alerts";

const JOBS: [string, (now: Date) => Promise<unknown>][] = [
  ["auto-close", runAutoClose],
  ["sla alerts", runSlaAlerts],
  ["email", (now) => drainOutbox(now)],
];

// one failing job shouldn't stop the others
export async function runJobsForCompany(now: Date): Promise<void> {
  for (const [name, job] of JOBS) {
    try {
      await job(now);
    } catch (error) {
      logger.error(`job ${name} failed`, error);
    }
  }
}

export async function runAllCompanies(now = new Date(), shouldStop: () => boolean = () => false): Promise<void> {
  const companies = await systemPrisma.company.findMany({ select: { id: true } });
  for (const c of companies) {
    if (shouldStop()) break;
    await runWithCompany(c.id, () => runJobsForCompany(now));
  }
}
