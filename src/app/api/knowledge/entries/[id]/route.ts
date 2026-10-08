import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";

export const PUT = withAuth(
  "knowledge:update",
  async (request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { title, content, priority, isActive, categoryId } = body;

      // drafts are only switched on by approving them
      const existing = await prisma.knowledgeEntry.findFirst({ where: { id, status: "approved" } });
      if (!existing) {
        return NextResponse.json(
          { error: "Entry not found" },
          { status: 404 }
        );
      }

      const entry = await prisma.knowledgeEntry.update({
        where: { id },
        data: {
          ...(title !== undefined && { title: title.trim() }),
          ...(content !== undefined && { content: content.trim() }),
          ...(priority !== undefined && { priority }),
          ...(isActive !== undefined && { isActive }),
          ...(categoryId !== undefined && { categoryId }),
          version: { increment: 1 },
        },
        include: {
          category: {
            select: { id: true, name: true, color: true, icon: true },
          },
        },
      });

      return NextResponse.json(entry);
    } catch (error) {
      logger.error("Failed to update entry:", error);
      return NextResponse.json(
        { error: "Failed to update entry" },
        { status: 500 }
      );
    }
  }
);

export const DELETE = withAuth(
  "knowledge:delete",
  async (_request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const existing = await prisma.knowledgeEntry.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json(
          { error: "Entry not found" },
          { status: 404 }
        );
      }

      await prisma.knowledgeEntry.delete({ where: { id } });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error("Failed to delete entry:", error);
      return NextResponse.json(
        { error: "Failed to delete entry" },
        { status: 500 }
      );
    }
  }
);
