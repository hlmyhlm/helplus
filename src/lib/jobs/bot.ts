import { runBotIntake, cleanBotInbound } from "@/lib/bot/intake";
import { logger } from "@/lib/logger";

// a failed intake shouldn't stop the cleanup
export async function runBot(now: Date): Promise<void> {
  try {
    await runBotIntake(now);
  } catch (error) {
    logger.error("bot intake failed", error);
  }
  try {
    await cleanBotInbound(now);
  } catch (error) {
    logger.error("bot cleanup failed", error);
  }
}
