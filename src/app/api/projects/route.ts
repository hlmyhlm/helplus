import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { projectSchema, validateBody } from "@/lib/validations";
import { allowedProjectIds } from "@/lib/tickets/access";
import { OPEN_STATUSES } from "@/lib/tickets/status";

export const GET = withAuth("projects:read", async (request: NextRequest, auth) => {
  const allowed = await allowedProjectIds(auth);
  // ?archived=1 includes archived projects alongside active ones (the project detail page needs this)
  const showArchived = request.nextUrl.searchParams.get("archived") === "1";
  const where = {
    ...(allowed === null ? {} : { id: { in: allowed } }),
    ...(showArchived ? {} : { archived: false }),
  };
  const projects = await prisma.project.findMany({ where, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  const ids = projects.map((p) => p.id);
  const [tickets, people] = await Promise.all([
    prisma.ticket.groupBy({
      by: ["projectId"],
      where: { projectId: { in: ids }, status: { in: OPEN_STATUSES } },
      _count: { _all: true },
    }),
    prisma.customer.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _count: { _all: true } }),
  ]);
  const count = (rows: { projectId: string | null; _count: { _all: number } }[], id: string) =>
    rows.find((r) => r.projectId === id)?._count._all ?? 0;
  return NextResponse.json({
    data: projects.map((p) => ({
      ...p,
      openTickets: count(tickets as never, p.id),
      people: count(people as never, p.id),
    })),
  });
});

export const POST = withAuth("projects:manage", async (request: NextRequest) => {
  const validation = validateBody(projectSchema, await request.json());
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
  try {
    const project = await prisma.project.create({ data: { name: validation.data.name } });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A project with that name already exists" }, { status: 409 });
    }
    logger.error("Failed to create project:", error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
});
