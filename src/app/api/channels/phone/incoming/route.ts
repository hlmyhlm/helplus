import { NextRequest, NextResponse } from "next/server";
import { handleIncomingCall } from "@/lib/channels/phone";
import { isTwilioRequestAllowed } from "@/lib/twilio-verify";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const params: Record<string, string> = {};
    formData.forEach((value, key) => {
      params[key] = String(value);
    });

    if (!(await isTwilioRequestAllowed(request, params))) {
      logger.warn("[Phone] Rejected Twilio request on incoming call (bad signature or unreadable token)");
      return new NextResponse("Forbidden", { status: 403 });
    }

    const from = params.From || "";
    const callSid = params.CallSid || "";

    const twiml = await handleIncomingCall(from, callSid);

    return new NextResponse(twiml, {
      headers: { "Content-Type": "text/xml" },
    });
  } catch (error) {
    logger.error("[Phone] Failed to handle incoming call:", error);
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>An error occurred. Please try again later.</Say></Response>',
      { headers: { "Content-Type": "text/xml" } }
    );
  }
}
