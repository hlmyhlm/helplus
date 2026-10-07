import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { withAuth } from "@/lib/tenant/with-auth";
import { allowedProjectIds, projectWhere } from "@/lib/tickets/access";

export const GET = withAuth("knowledge:read", async (request: NextRequest, auth) => {
  try {
    const { searchParams } = new URL(request.url);
    const ids = await allowedProjectIds(auth);
    const projectId = searchParams.get("projectId");
    // a picked project only narrows the scope, never widens it
    const scope = projectId ? projectWhere(ids === null || ids.includes(projectId) ? [projectId] : []) : projectWhere(ids);
    const where = { status: "draft", ...scope };

    if (searchParams.get("count") === "1") {
      return NextResponse.json({ count: await prisma.knowledgeEntry.count({ where }) });
    }

    const { page, limit, skip, take } = parsePagination(searchParams);
    const [drafts, total] = await Promise.all([
      prisma.knowledgeEntry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          title: true,
          content: true,
          categoryId: true,
          projectId: true,
          project: { select: { name: true } },
          sourceTicketId: true,
          sourceTicket: { select: { number: true } },
          createdAt: true,
        },
      }),
      prisma.knowledgeEntry.count({ where }),
    ]);

    return NextResponse.json(paginatedResponse(drafts, total, page, limit));
  } catch (error) {
    logger.error("Failed to fetch drafts:", error);
    return NextResponse.json({ error: "Failed to fetch drafts" }, { status: 500 });
  }
});
