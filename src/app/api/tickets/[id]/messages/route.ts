import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { ticketReplySchema, validateBody } from "@/lib/validations";
import { loadTicketFor } from "@/lib/tickets/load";
import { statusChange } from "@/lib/tickets/status";
import { emitNewMessage } from "@/lib/realtime";

type Ctx = { params: Promise<{ id: string }> };

// the reply is stored on the ticket. sending it to the client's channel is up to staff for now.
export const POST = withAuth("tickets:update", async (request: NextRequest, auth, { params }: Ctx) => {
  try {
    const { id } = await params;
    const ticket = await loadTicketFor(auth, id);
    if (!ticket || !ticket.conversationId) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    if (ticket.status === "closed") return NextResponse.json({ error: "Reopen the ticket first" }, { status: 409 });

    const validation = validateBody(ticketReplySchema, await request.json());
    if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
    const { content, markAnswered = true } = validation.data;

    const message = await prisma.message.create({
      data: { conversationId: ticket.conversationId, role: "agent", content },
    });

    const now = new Date();
    const data: Record<string, unknown> = markAnswered ? statusChange(ticket, "answered", now) : {};
    if (!ticket.firstReplyAt) data.firstReplyAt = now;
    if (!ticket.assigneeId) data.assigneeId = auth.userId.startsWith("api-key:") ? null : auth.userId;
    await prisma.ticket.update({ where: { id }, data });

    emitNewMessage(ticket.conversationId, { id: message.id, role: "agent", content });
    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    logger.error("Failed to add reply:", error);
    return NextResponse.json({ error: "Failed to add reply" }, { status: 500 });
  }
});
