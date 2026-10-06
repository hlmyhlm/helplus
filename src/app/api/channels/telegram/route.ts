import { NextRequest, NextResponse } from "next/server";
import { handleTelegramUpdate } from "@/lib/channels/telegram";
import { logger } from "@/lib/logger";
import { runWithCompany } from "@/lib/tenant/context";
import { resolveWebhookCompany } from "@/lib/tenant/webhook-company";
import { isTelegramRequestAllowed } from "@/lib/telegram-verify";

export async function POST(request: NextRequest) {
  const companyId = await resolveWebhookCompany(request);
  if (!companyId) {
    return new NextResponse("Unknown company", { status: 404 });
  }
  return runWithCompany(companyId, async () => {
    if (!(await isTelegramRequestAllowed(request))) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    try {
      const update = await request.json();

      await handleTelegramUpdate(update);

      // Telegram expects 200 OK quickly
      return NextResponse.json({ ok: true });
    } catch (error) {
      logger.error("[Telegram] Webhook error:", error);
      return NextResponse.json({ ok: true }); // Always 200 for Telegram
    }
  });
}
