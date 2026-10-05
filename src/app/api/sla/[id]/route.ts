import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";

export const PUT = withAuth(
  "sla:update",
  async (request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { name, description, channel, priority, firstResponseMins, resolutionMins, isActive } = body;

      const existing = await prisma.sLARule.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json(
          { error: "SLA rule not found" },
          { status: 404 }
        );
      }

      const rule = await prisma.sLARule.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && { description: description.trim() }),
          ...(channel !== undefined && { channel }),
          ...(priority !== undefined && { priority }),
          ...(firstResponseMins !== undefined && { firstResponseMins }),
          ...(resolutionMins !== undefined && { resolutionMins }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      return NextResponse.json(rule);
    } catch (error) {
      logger.error("Failed to update SLA rule:", error);
      return NextResponse.json(
        { error: "Failed to update SLA rule" },
        { status: 500 }
      );
    }
  }
);

export const DELETE = withAuth(
  "sla:delete",
  async (_request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const existing = await prisma.sLARule.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json(
          { error: "SLA rule not found" },
          { status: 404 }
        );
      }

      await prisma.sLARule.delete({ where: { id } });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error("Failed to delete SLA rule:", error);
      return NextResponse.json(
        { error: "Failed to delete SLA rule" },
        { status: 500 }
      );
    }
  }
);
