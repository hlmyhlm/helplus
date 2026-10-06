import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { ticketNoteSchema, validateBody } from "@/lib/validations";
import { loadTicketFor } from "@/lib/tickets/load";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth("tickets:read", async (_request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const ticket = await loadTicketFor(auth, id);
  if (!ticket?.conversationId) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  const notes = await prisma.internalNote.findMany({
    where: { conversationId: ticket.conversationId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(notes);
});

export const POST = withAuth("tickets:update", async (request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const ticket = await loadTicketFor(auth, id);
  if (!ticket?.conversationId) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  const validation = validateBody(ticketNoteSchema, await request.json());
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
  const note = await prisma.internalNote.create({
    data: { conversationId: ticket.conversationId, content: validation.data.content, authorName: auth.name },
  });
  return NextResponse.json(note, { status: 201 });
});
