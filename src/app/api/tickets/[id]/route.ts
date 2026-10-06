import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { updateTicketSchema, validateBody } from "@/lib/validations";
import { allowedProjectIds, canSeeProject } from "@/lib/tickets/access";
import { loadTicketFor } from "@/lib/tickets/load";
import { statusChange, InvalidTransitionError } from "@/lib/tickets/status";
import { saveTicket, loadSlaContext } from "@/lib/tickets/update";
import { STAFF_ROLES } from "@/lib/rbac";
import { projectProblem } from "@/lib/projects/usable";
import { notifyTicket } from "@/lib/notify/notify";
import { removeAttachmentFiles } from "@/lib/attachments/files";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: "Ticket not found" }, { status: 404 });
const cantSee = () => NextResponse.json({ error: "That person can't see this project" }, { status: 400 });

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
      attachments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          messageId: true,
          fileName: true,
          status: true,
          icCount: true,
          width: true,
          height: true,
          checkNote: true,
          originalDeletedAt: true,
          createdAt: true,
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

    const now = new Date();
    const data: Record<string, unknown> = { ...rest };
    if (status) Object.assign(data, statusChange(ticket, status, now));

    if (assigneeId !== undefined) {
      if (assigneeId !== null) {
        const user = await prisma.admin.findUnique({ where: { id: assigneeId }, select: { role: true } });
        if (!user || !(STAFF_ROLES as readonly string[]).includes(user.role) || user.role === "viewer") {
          return NextResponse.json({ error: "Can't assign to that user" }, { status: 400 });
        }
        if (!(await canSeeProject({ id: assigneeId, role: user.role }, projectId ?? ticket.projectId))) {
          return cantSee();
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
      if (assigneeId === undefined && ticket.assigneeId) {
        const current = await prisma.admin.findUnique({ where: { id: ticket.assigneeId }, select: { role: true } });
        if (current && !(await canSeeProject({ id: ticket.assigneeId, role: current.role }, projectId))) return cantSee();
      }
    }

    const conversationId = ticket.conversationId;
    if (projectId === undefined || projectId === ticket.projectId || !conversationId) {
      return NextResponse.json(await saveTicket(ticket, data, { now, actorId: auth.userId }));
    }

    // the thread is shared, so its other tickets move too, all in one go
    const ctx = await loadSlaContext();
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await saveTicket(ticket, data, { now, ctx, db: tx, notify: false });
      const open = await tx.ticket.findMany({ where: { conversationId, id: { not: id }, status: { not: "closed" } } });
      for (const sibling of open) await saveTicket(sibling, { projectId }, { db: tx, ctx, now, notify: false });
      await tx.ticket.updateMany({ where: { conversationId, id: { not: id }, status: "closed" }, data: { projectId } });
      return saved;
    });
    if (data.status === "reopened" && ticket.status !== "reopened") {
      await notifyTicket("reopened", updated, { actorId: auth.userId });
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
  await removeAttachmentFiles({ ticketId: id });
  await prisma.ticket.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
