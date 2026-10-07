import { runBotIntake, cleanBotInbound } from "@/lib/bot/intake";

export async function runBot(now: Date): Promise<void> {
  await runBotIntake(now);
  await cleanBotInbound(now);
}
