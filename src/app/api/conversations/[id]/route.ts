import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { emitConversationUpdate } from "@/lib/realtime";
import { allowedProjectIds, conversationWhere } from "@/lib/tickets/access";
import { loadConversationFor } from "@/lib/tickets/load";
import { removeAttachmentFiles } from "@/lib/attachments/files";

export const GET = withAuth(
  "conversations:read",
  async (_request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const conversation = await prisma.conversation.findUnique({
        where: { id, ...conversationWhere(await allowedProjectIds(auth)) },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
          customer: true,
          tags: {
            include: { tag: true },
          },
          tickets: {
            include: {
              department: true,
              assignedTo: true,
            },
          },
          _count: {
            select: { messages: true },
          },
        },
      });

      if (!conversation) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }

      return NextResponse.json(conversation);
    } catch (error) {
      logger.error("Failed to fetch conversation:", error);
      return NextResponse.json(
        { error: "Failed to fetch conversation" },
        { status: 500 }
      );
    }
  }
);

export const PUT = withAuth(
  "conversations:update",
  async (request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { status, customerName, customerContact, summary, satisfaction, tagIds } = body;

      const validStatuses = ["active", "resolved", "closed", "escalated", "snoozed"];
      if (status !== undefined && !validStatuses.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` },
          { status: 400 }
        );
      }

      if (satisfaction !== undefined && satisfaction !== null) {
        if (!Number.isInteger(satisfaction) || satisfaction < 1 || satisfaction > 5) {
          return NextResponse.json(
            { error: "Satisfaction must be an integer between 1 and 5" },
            { status: 400 }
          );
        }
      }

      const existing = await loadConversationFor(auth, id);
      if (!existing) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }

      const conversation = await prisma.conversation.update({
        where: { id },
        data: {
          ...(status !== undefined && { status }),
          ...(customerName !== undefined && { customerName: customerName.trim() }),
          ...(customerContact !== undefined && { customerContact: customerContact.trim() }),
          ...(summary !== undefined && { summary: summary.trim() }),
          ...(satisfaction !== undefined && { satisfaction }),
        },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
          },
          tags: {
            include: { tag: true },
          },
          _count: {
            select: { messages: true },
          },
        },
      });

      if (tagIds && Array.isArray(tagIds)) {
        await prisma.conversationTag.deleteMany({
          where: { conversationId: id },
        });

        if (tagIds.length > 0) {
          await prisma.conversationTag.createMany({
            data: tagIds.map((tagId: string) => ({
              conversationId: id,
              tagId,
            })),
          });
        }

        const updated = await prisma.conversation.findUnique({
          where: { id },
          include: {
            messages: { orderBy: { createdAt: "asc" } },
            tags: { include: { tag: true } },
            _count: { select: { messages: true } },
          },
        });

        return NextResponse.json(updated);
      }

      emitConversationUpdate(id, { status, customerName });

      return NextResponse.json(conversation);
    } catch (error) {
      logger.error("Failed to update conversation:", error);
      return NextResponse.json(
        { error: "Failed to update conversation" },
        { status: 500 }
      );
    }
  }
);

export const DELETE = withAuth(
  "conversations:delete",
  async (_request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const existing = await loadConversationFor(auth, id);
      if (!existing) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }

      await removeAttachmentFiles({ ticket: { conversationId: id } });
      await prisma.conversation.delete({ where: { id } });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error("Failed to delete conversation:", error);
      return NextResponse.json(
        { error: "Failed to delete conversation" },
        { status: 500 }
      );
    }
  }
);
