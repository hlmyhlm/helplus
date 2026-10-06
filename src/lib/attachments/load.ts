import { prisma } from "@/lib/prisma";
import { loadTicketFor } from "@/lib/tickets/load";

// an attachment is visible when its ticket is
export async function loadAttachmentFor(auth: { role: string; userId: string }, id: string) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a || !(await loadTicketFor(auth, a.ticketId))) return null;
  return a;
}
