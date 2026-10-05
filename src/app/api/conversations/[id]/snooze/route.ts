import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { snoozeConversation } from "@/lib/conversation-engine";
import { logger } from "@/lib/logger";

export const POST = withAuth(
  "conversations:update",
  async (request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { snoozeUntil, reason } = body;

      if (!snoozeUntil) {
        return NextResponse.json(
          { error: "snoozeUntil is required" },
          { status: 400 }
        );
      }

      const success = await snoozeConversation(
        id,
        new Date(snoozeUntil),
        reason || "",
        auth.name
      );

      return NextResponse.json({ success });
    } catch (error) {
      logger.error("Failed to snooze conversation:", error);
      return NextResponse.json(
        { error: "Failed to snooze" },
        { status: 500 }
      );
    }
  }
);
