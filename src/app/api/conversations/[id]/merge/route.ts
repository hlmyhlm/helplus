import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { mergeConversations } from "@/lib/conversation-engine";
import { logger } from "@/lib/logger";

export const POST = withAuth(
  "conversations:update",
  async (request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { secondaryId } = body;

      if (!secondaryId) {
        return NextResponse.json(
          { error: "secondaryId is required" },
          { status: 400 }
        );
      }

      const success = await mergeConversations(id, secondaryId);

      if (!success) {
        return NextResponse.json(
          { error: "Merge failed" },
          { status: 400 }
        );
      }

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error("Failed to merge conversations:", error);
      return NextResponse.json(
        { error: "Failed to merge" },
        { status: 500 }
      );
    }
  }
);
