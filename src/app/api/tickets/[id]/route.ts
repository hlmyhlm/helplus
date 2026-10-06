import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { updateTicketSchema, validateBody } from "@/lib/validations";
import { allowedProjectIds } from "@/lib/tickets/access";
import { loadTicketFor } from "@/lib/tickets/load";
import { statusChange, InvalidTransitionError } from "@/lib/tickets/status";
import { STAFF_ROLES } from "@/lib/rbac";
import { projectProblem } from "@/lib/projects/usable";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: "Ticket not found" }, { status: 404 });

export const GET = withAuth("tickets:read", async (_request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  if (!(await loadTicketFor(auth, id))) return notFound();
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      conversation: {
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          notes: { orderBy: { createdAt: "desc" } },
          customer: { select: { id: true, name: true, phone: true, email: true } },
        },
      },
    },
  });
  return NextResponse.json(ticket);
});

export const PATCH = withAuth("tickets:update", async (request: NextRequest, auth, { params }: Ctx) => {
  try {
    const { id } = await params;
    const ticket = await loadTicketFor(auth, id);
    if (!ticket) return notFound();

    const validation = validateBody(updateTicketSchema, await request.json());
    if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
    const { status, assigneeId, projectId, ...rest } = validation.data;

    const data: Record<string, unknown> = { ...rest };
    if (status) Object.assign(data, statusChange(ticket, status));

    if (assigneeId !== undefined) {
      if (assigneeId !== null) {
        const user = await prisma.admin.findUnique({ where: { id: assigneeId }, select: { role: true } });
        if (!user || !(STAFF_ROLES as readonly string[]).includes(user.role) || user.role === "viewer") {
          return NextResponse.json({ error: "Can't assign to that user" }, { status: 400 });
        }
        if (user.role === "staff") {
          const access = await prisma.projectAccess.findFirst({
            where: { adminId: assigneeId, projectId: projectId ?? ticket.projectId },
          });
          if (!access) return NextResponse.json({ error: "That person can't see this project" }, { status: 400 });
        }
      }
      data.assigneeId = assigneeId;
    }

    if (projectId !== undefined) {
      const allowed = await allowedProjectIds(auth);
      if (allowed !== null && !allowed.includes(projectId)) {
        return NextResponse.json({ error: "Not allowed for this project" }, { status: 403 });
      }
      const problem = await projectProblem(projectId);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      data.projectId = projectId;
    }

    const updated = await prisma.ticket.update({ where: { id }, data });
    // the thread is shared, so its other tickets move too
    if (projectId !== undefined && ticket.conversationId) {
      await prisma.ticket.updateMany({
        where: { conversationId: ticket.conversationId, id: { not: id } },
        data: { projectId },
      });
    }
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    logger.error("Failed to update ticket:", error);
    return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
  }
});

export const DELETE = withAuth("tickets:delete", async (_request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  if (!(await loadTicketFor(auth, id))) return notFound();
  await prisma.ticket.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
