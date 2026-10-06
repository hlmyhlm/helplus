import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { retryDelivery } from "@/lib/webhook-delivery";
import { withAuth } from "@/lib/tenant/with-auth";

export const GET = withAuth(
  "webhooks:read",
  async (request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const { searchParams } = new URL(request.url);
      const { page, limit, skip, take } = parsePagination(searchParams);
      const status = searchParams.get("status");

      const where: Record<string, unknown> = { webhookId: id };
      if (status && status !== "all") {
        where.status = status;
      }

      const [deliveries, total] = await Promise.all([
        prisma.webhookDelivery.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take,
        }),
        prisma.webhookDelivery.count({ where }),
      ]);

      return NextResponse.json(paginatedResponse(deliveries, total, page, limit));
    } catch (error) {
      logger.error("Failed to fetch webhook deliveries:", error);
      return NextResponse.json(
        { error: "Failed to fetch deliveries" },
        { status: 500 }
      );
    }
  }
);

export const POST = withAuth(
  "webhooks:update",
  async (request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { deliveryId } = body;

      if (!deliveryId) {
        return NextResponse.json(
          { error: "deliveryId is required" },
          { status: 400 }
        );
      }

      const delivery = await prisma.webhookDelivery.findFirst({
        where: { id: deliveryId, webhookId: id },
      });

      if (!delivery) {
        return NextResponse.json(
          { error: "Delivery not found" },
          { status: 404 }
        );
      }

      const success = await retryDelivery(deliveryId);

      return NextResponse.json({ success, deliveryId });
    } catch (error) {
      logger.error("Failed to retry webhook delivery:", error);
      return NextResponse.json(
        { error: "Failed to retry delivery" },
        { status: 500 }
      );
    }
  }
);
