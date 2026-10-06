import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { withAuth } from "@/lib/tenant/with-auth";
import { createTicketSchema, validateBody } from "@/lib/validations";
import { allowedProjectIds, projectWhere } from "@/lib/tickets/access";
import { OPEN_STATUSES, TICKET_STATUSES, isTicketStatus, type TicketStatus } from "@/lib/tickets/status";
import { createTicket } from "@/lib/tickets/service";

const ROW_INCLUDE = {
  project: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  conversation: { select: { customerName: true, customerContact: true, channel: true } },
} as const;

function statusFilter(value: string | null): Record<string, unknown> {
  if (!value || value === "all") return {};
  if (value === "open") return { status: { in: OPEN_STATUSES } };
  const list = value.split(",").filter(isTicketStatus);
  return list.length ? { status: { in: list } } : {};
}

export const GET = withAuth("tickets:read", async (request: NextRequest, auth) => {
  try {
    const params = request.nextUrl.searchParams;
    const { page, limit, skip, take } = parsePagination(params);
    const scope = projectWhere(await allowedProjectIds(auth));

    const filters: Record<string, unknown>[] = [scope];
    const projectId = params.get("projectId");
    if (projectId) filters.push({ projectId });
    const assignee = params.get("assignee");
    if (assignee === "me") filters.push({ assigneeId: auth.userId });
    else if (assignee === "unassigned") filters.push({ assigneeId: null });
    else if (assignee) filters.push({ assigneeId: assignee });
    const source = params.get("source");
    if (source) filters.push({ source });
    const q = params.get("q")?.trim();
    if (q) {
      const asNumber = Number(q.replace(/^#/, ""));
      filters.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { conversation: { customerName: { contains: q, mode: "insensitive" } } },
          ...(Number.isInteger(asNumber) && asNumber > 0 ? [{ number: asNumber }] : []),
        ],
      });
    }

    const where = { AND: [...filters, statusFilter(params.get("status"))] };
    const countWhere = { AND: filters };

    const [rows, total, grouped] = await Promise.all([
      prisma.ticket.findMany({ where, orderBy: { updatedAt: "desc" }, skip, take, include: ROW_INCLUDE }),
      prisma.ticket.count({ where }),
      prisma.ticket.groupBy({ by: ["status"], where: countWhere, _count: { _all: true } }),
    ]);

    const counts = Object.fromEntries(TICKET_STATUSES.map((s) => [s, 0])) as Record<TicketStatus, number>;
    for (const g of grouped as { status: string; _count: { _all: number } }[]) {
      if (isTicketStatus(g.status)) counts[g.status] = g._count._all;
    }

    return NextResponse.json({ ...paginatedResponse(rows, total, page, limit), counts });
  } catch (error) {
    logger.error("Failed to fetch tickets:", error);
    return NextResponse.json({ error: "Failed to fetch tickets" }, { status: 500 });
  }
});

export const POST = withAuth("tickets:create", async (request: NextRequest, auth) => {
  try {
    const validation = validateBody(createTicketSchema, await request.json());
    if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });

    const allowed = await allowedProjectIds(auth);
    const projectId = validation.data.projectId;
    if (allowed !== null) {
      if (!projectId) return NextResponse.json({ error: "Choose a project" }, { status: 400 });
      if (!allowed.includes(projectId)) return NextResponse.json({ error: "Not allowed for this project" }, { status: 403 });
    }

    const ticket = await createTicket(validation.data);
    return NextResponse.json(ticket, { status: 201 });
  } catch (error) {
    logger.error("Failed to create ticket:", error);
    return NextResponse.json({ error: "Failed to create ticket" }, { status: 500 });
  }
});
