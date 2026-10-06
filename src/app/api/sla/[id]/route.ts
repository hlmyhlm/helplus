import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { updateSLARuleSchema, validateBody } from "@/lib/validations";

export const PUT = withAuth(
  "sla:update",
  async (request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const parsed = validateBody(updateSLARuleSchema, body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      // zod fills defaults even in partial(), so only keep keys the client sent
      const sent = body && typeof body === "object" ? body : {};
      const d = Object.fromEntries(
        Object.entries(parsed.data).filter(([k]) => k in sent)
      ) as typeof parsed.data;

      const existing = await prisma.sLARule.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json(
          { error: "SLA rule not found" },
          { status: 404 }
        );
      }

      if (d.projectId && !(await prisma.project.findFirst({ where: { id: d.projectId } }))) {
        return NextResponse.json({ error: "Project not found" }, { status: 400 });
      }

      const rule = await prisma.sLARule.update({
        where: { id },
        data: {
          ...(d.name !== undefined && { name: d.name }),
          ...(d.description !== undefined && { description: d.description.trim() }),
          ...(d.projectId !== undefined && { projectId: d.projectId || null }),
          ...(d.priority !== undefined && { priority: d.priority }),
          ...(d.category !== undefined && { category: d.category || "all" }),
          ...(d.source !== undefined && { source: d.source || "all" }),
          ...(d.firstResponseMins !== undefined && { firstResponseMins: d.firstResponseMins }),
          ...(d.resolutionMins !== undefined && { resolutionMins: d.resolutionMins }),
          ...(d.isActive !== undefined && { isActive: d.isActive }),
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
