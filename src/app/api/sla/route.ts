import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { withAuth } from "@/lib/tenant/with-auth";
import { createSLARuleSchema, validateBody } from "@/lib/validations";
import { allowedProjectIds } from "@/lib/tickets/access";

export const GET = withAuth(
  "sla:read",
  async (request: NextRequest, auth) => {
    try {
      const { searchParams } = new URL(request.url);
      const { page, limit, skip, take } = parsePagination(searchParams);
      // project names are client names, limited users only see their own
      const ids = await allowedProjectIds(auth);
      const where = ids === null ? {} : { OR: [{ projectId: null }, { projectId: { in: ids } }] };

      const [rules, total] = await Promise.all([
        prisma.sLARule.findMany({
          where,
          orderBy: { createdAt: "desc" },
          include: { project: { select: { id: true, name: true } } },
          skip,
          take,
        }),
        prisma.sLARule.count({ where }),
      ]);

      return NextResponse.json(paginatedResponse(rules, total, page, limit));
    } catch (error) {
      logger.error("Failed to fetch SLA rules:", error);
      return NextResponse.json(
        { error: "Failed to fetch SLA rules" },
        { status: 500 }
      );
    }
  }
);

export const POST = withAuth(
  "sla:create",
  async (request: NextRequest, _auth) => {
    try {
      const parsed = validateBody(createSLARuleSchema, await request.json());
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      const d = parsed.data;

      if (d.projectId && !(await prisma.project.findFirst({ where: { id: d.projectId } }))) {
        return NextResponse.json({ error: "Project not found" }, { status: 400 });
      }

      const rule = await prisma.sLARule.create({
        data: {
          name: d.name,
          description: d.description?.trim() || "",
          projectId: d.projectId || null,
          priority: d.priority,
          category: d.category || "all",
          source: d.source || "all",
          firstResponseMins: d.firstResponseMins,
          resolutionMins: d.resolutionMins,
          isActive: d.isActive,
        },
      });

      return NextResponse.json(rule, { status: 201 });
    } catch (error) {
      logger.error("Failed to create SLA rule:", error);
      return NextResponse.json(
        { error: "Failed to create SLA rule" },
        { status: 500 }
      );
    }
  }
);
