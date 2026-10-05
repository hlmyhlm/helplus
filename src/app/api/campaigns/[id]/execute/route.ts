import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { findTargetCustomers, type CampaignSegment } from "@/lib/campaigns";
import { logger } from "@/lib/logger";

export const POST = withAuth(
  "automation:create",
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

      const customers = await findTargetCustomers(
        campaign.segments as unknown as CampaignSegment[]
      );

      return NextResponse.json({
        campaignId: id,
        targetCount: customers.length,
      });
    } catch (error) {
      logger.error("Failed to execute campaign:", error);
      return NextResponse.json(
        { error: "Failed to execute campaign" },
        { status: 500 }
      );
    }
  }
);
