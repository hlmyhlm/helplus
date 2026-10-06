import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { loadConversationFor } from "@/lib/tickets/load";
import { transferConversation } from "@/lib/conversation-engine";
import { logger } from "@/lib/logger";

export const POST = withAuth(
  "conversations:transfer",
  async (request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      if (!(await loadConversationFor(auth, id))) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }
      const body = await request.json();
      const { toMemberId, note } = body;

      if (!toMemberId) {
        return NextResponse.json(
          { error: "toMemberId is required" },
          { status: 400 }
        );
      }

      const success = await transferConversation(
        id,
        toMemberId,
        auth.name,
        note
      );

      if (!success) {
        return NextResponse.json(
          { error: "Transfer failed" },
          { status: 400 }
        );
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error("Failed to transfer conversation:", error);
      return NextResponse.json(
        { error: "Failed to transfer" },
        { status: 500 }
      );
    }
  }
);
