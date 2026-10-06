import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { loadConversationFor } from "@/lib/tickets/load";

export const POST = withAuth(
  "conversations:update",
  async (request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      if (!(await loadConversationFor(auth, id))) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }
      const body = await request.json();
      const { rating } = body;

      if (!rating || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return NextResponse.json(
          { error: "Rating must be an integer between 1 and 5" },
          { status: 400 }
        );
      }

      const conversation = await prisma.conversation.update({
        where: { id },
        data: { satisfaction: rating },
      });

      return NextResponse.json({
        success: true,
        satisfaction: conversation.satisfaction,
      });
    } catch (error) {
      logger.error("Failed to update satisfaction:", error);
      return NextResponse.json(
        { error: "Failed to update satisfaction" },
        { status: 500 }
      );
    }
  }
);
