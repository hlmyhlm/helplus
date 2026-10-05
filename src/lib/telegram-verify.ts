import { createHash, timingSafeEqual } from "crypto";
import { getSettingsWithStatus } from "@/lib/settings";

// hash both sides so the compare takes the same time whatever the lengths
function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Telegram sends the secret_token given to setWebhook in X-Telegram-Bot-Api-Secret-Token.
 * With no secret configured the request is refused unless HELPLUS_ALLOW_UNSIGNED_WEBHOOKS is set.
 */
export async function isTelegramRequestAllowed(request: Request): Promise<boolean> {
  const { settings, undecryptable } = await getSettingsWithStatus();
  if (undecryptable.includes("telegramWebhookSecret")) return false;
  const secret = settings.telegramWebhookSecret;
  if (!secret) return process.env.HELPLUS_ALLOW_UNSIGNED_WEBHOOKS === "true";
  const header = request.headers.get("x-telegram-bot-api-secret-token");
  return header !== null && sameSecret(header, secret);
}
