import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";

export const GET = withAuth(
  "automation:read",
  async (_request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const flow = await prisma.flow.findUnique({ where: { id } });
      if (!flow) {
        return NextResponse.json(
          { error: "Flow not found" },
          { status: 404 }
        );
      }

      return NextResponse.json(flow);
    } catch (error) {
      logger.error("Failed to fetch flow:", error);
      return NextResponse.json(
        { error: "Failed to fetch flow" },
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
      const { name, description, startNodeId, nodes, isActive } = body;

      const existing = await prisma.flow.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json(
          { error: "Flow not found" },
          { status: 404 }
        );
      }

      const flow = await prisma.flow.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && { description: description.trim() }),
          ...(startNodeId !== undefined && { startNodeId }),
          ...(nodes !== undefined && { nodes }),
          ...(isActive !== undefined && { isActive }),
        },
      });

      return NextResponse.json(flow);
    } catch (error) {
      logger.error("Failed to update flow:", error);
      return NextResponse.json(
        { error: "Failed to update flow" },
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

      const existing = await prisma.flow.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json(
          { error: "Flow not found" },
          { status: 404 }
        );
      }

      await prisma.flow.delete({ where: { id } });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error("Failed to delete flow:", error);
      return NextResponse.json(
        { error: "Failed to delete flow" },
        { status: 500 }
      );
    }
  }
);
