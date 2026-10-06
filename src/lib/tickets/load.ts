import { prisma } from "@/lib/prisma";
import { allowedProjectIds, conversationWhere } from "./access";

// a ticket the user may see, else null
export async function loadTicketFor(auth: { role: string; userId: string }, id: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return null;
  const allowed = await allowedProjectIds(auth);
  if (allowed !== null && !allowed.includes(ticket.projectId)) return null;
  return ticket;
}

// same for conversations: null when missing or outside the user's projects
export async function loadConversationFor(auth: { role: string; userId: string }, id: string) {
  const scope = conversationWhere(await allowedProjectIds(auth));
  return prisma.conversation.findUnique({ where: { id, ...scope } });
}
