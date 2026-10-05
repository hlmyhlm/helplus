import { NextRequest, NextResponse } from "next/server";
import { handleCallEnd } from "@/lib/channels/phone";
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
      logger.warn("[Phone] Rejected Twilio request on status callback (bad signature or unreadable token)");
      return new NextResponse("Forbidden", { status: 403 });
    }

    const callSid = params.CallSid || "";
    const callDuration = parseInt(params.CallDuration || "0") || 0;
    const callStatus = params.CallStatus || "";

    if (callStatus === "completed" || callStatus === "failed" || callStatus === "no-answer") {
      await handleCallEnd(callSid, callDuration);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("[Phone] Failed to handle call status:", error);
    return NextResponse.json({ ok: true });
  }
}
