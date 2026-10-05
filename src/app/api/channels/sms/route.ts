import { NextRequest, NextResponse } from "next/server";
import { handleIncomingSms } from "@/lib/channels/sms";
import { isTwilioRequestAllowed } from "@/lib/twilio-verify";
import { logger } from "@/lib/logger";
import { runWithCompany } from "@/lib/tenant/context";
import { resolveWebhookCompany } from "@/lib/tenant/webhook-company";

export async function POST(request: NextRequest) {
  const companyId = await resolveWebhookCompany(request);
  if (!companyId) {
    return new NextResponse("Unknown company", { status: 404 });
  }
  return runWithCompany(companyId, async () => {
    try {
      const formData = await request.formData();
      const params: Record<string, string> = {};
      formData.forEach((value, key) => {
        params[key] = String(value);
      });

      if (!(await isTwilioRequestAllowed(request, params))) {
        logger.warn("[SMS] Rejected Twilio request (bad signature or unreadable token)");
        return new NextResponse("Forbidden", { status: 403 });
      }

      const from = params.From || "";
      const body = params.Body || "";

      const response = await handleIncomingSms(from, body);

      // Return TwiML response
      const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${response}</Message></Response>`;

      return new NextResponse(twiml, {
        headers: { "Content-Type": "text/xml" },
      });
    } catch (error) {
      logger.error("[SMS] Failed to handle incoming SMS:", error);
      return new NextResponse(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Message>An error occurred.</Message></Response>',
        { headers: { "Content-Type": "text/xml" } }
      );
    }
  });
}
