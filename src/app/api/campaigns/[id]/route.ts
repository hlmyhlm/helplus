import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";

export const GET = withAuth(
  "analytics:read",
  async (_request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const campaign = await prisma.campaign.findUnique({ where: { id } });
      if (!campaign) {
        return NextResponse.json(
          { error: "Campaign not found" },
          { status: 404 }
        );
      }

      return NextResponse.json(campaign);
    } catch (error) {
      logger.error("Failed to fetch campaign:", error);
      return NextResponse.json(
        { error: "Failed to fetch campaign" },
        { status: 500 }
      );
    }
  }
);

export const PUT = withAuth(
  "automation:update",
  async (request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { name, description, channel, message, subject, segments, status, scheduledAt } =
        body;

      const existing = await prisma.campaign.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json(
          { error: "Campaign not found" },
          { status: 404 }
        );
      }

      const campaign = await prisma.campaign.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && { description: description.trim() }),
          ...(channel !== undefined && { channel }),
          ...(message !== undefined && { message: message.trim() }),
          ...(subject !== undefined && { subject: subject.trim() }),
          ...(segments !== undefined && { segments }),
          ...(status !== undefined && { status }),
          ...(scheduledAt !== undefined && {
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
          }),
        },
      });

      return NextResponse.json(campaign);
    } catch (error) {
      logger.error("Failed to update campaign:", error);
      return NextResponse.json(
        { error: "Failed to update campaign" },
        { status: 500 }
      );
    }
  }
);

export const DELETE = withAuth(
  "automation:delete",
  async (_request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const existing = await prisma.campaign.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json(
          { error: "Campaign not found" },
          { status: 404 }
        );
      }

      await prisma.campaign.delete({ where: { id } });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error("Failed to delete campaign:", error);
      return NextResponse.json(
        { error: "Failed to delete campaign" },
        { status: 500 }
      );
    }
  }
);
