import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { loadConversationFor } from "@/lib/tickets/load";

export const GET = withAuth(
  "messages:read",
  async (_request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const conversation = await loadConversationFor(auth, id);
      if (!conversation) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }

      const notes = await prisma.internalNote.findMany({
        where: { conversationId: id },
        orderBy: { createdAt: "desc" },
      });

      return NextResponse.json(notes);
    } catch (error) {
      logger.error("Failed to fetch internal notes:", error);
      return NextResponse.json(
        { error: "Failed to fetch internal notes" },
        { status: 500 }
      );
    }
  }
);

export const POST = withAuth(
  "messages:create",
  async (request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { content, authorName } = body;

      if (!content || typeof content !== "string" || !content.trim()) {
        return NextResponse.json(
          { error: "Content is required" },
          { status: 400 }
        );
      }

      const conversation = await loadConversationFor(auth, id);
      if (!conversation) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }

      const note = await prisma.internalNote.create({
        data: {
          conversationId: id,
          content: content.trim(),
          authorName: authorName?.trim() || "Admin",
        },
      });

      return NextResponse.json(note, { status: 201 });
    } catch (error) {
      logger.error("Failed to create internal note:", error);
      return NextResponse.json(
        { error: "Failed to create internal note" },
        { status: 500 }
      );
    }
  }
);
