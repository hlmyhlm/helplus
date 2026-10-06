import { prisma } from "@/lib/prisma";
import { allowedProjectIds } from "./access";

// a ticket the user may see, or null. tickets in other projects look the same as missing ones.
export async function loadTicketFor(auth: { role: string; userId: string }, id: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return null;
  const allowed = await allowedProjectIds(auth);
  if (allowed !== null && !allowed.includes(ticket.projectId)) return null;
  return ticket;
}
