import { prisma } from "@/lib/prisma";
import { maskIC } from "@/lib/privacy/ic-mask";
import { defaultProjectId } from "@/lib/projects/default";
import { nextTicketNumber } from "./number";
import { OPEN_STATUSES } from "./status";

export function titleFrom(text: string): string {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!line) return "New issue";
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

export interface OpenTicketInput {
  conversationId: string;
  title?: string;
  description: string;
  source: string;
  projectId?: string;
  priority?: string;
  category?: string;
}

// parent rows are created before this runs: the link check can't see rows from an open transaction
export async function openTicket(input: OpenTicketInput) {
  const description = maskIC(input.description).text;
  const title = maskIC(input.title?.trim() || titleFrom(description)).text;
  return prisma.ticket.create({
    data: {
      number: await nextTicketNumber(),
      title,
      description,
      source: input.source,
      projectId: input.projectId || (await defaultProjectId()),
      priority: input.priority ?? "medium",
      category: input.category ?? "",
      status: "new",
      conversationId: input.conversationId,
    },
  });
}

export interface CreateTicketInput {
  text: string;
  title?: string;
  projectId?: string;
  source?: string;
  customerName?: string;
  customerContact?: string;
  category?: string;
  priority?: string;
}

export async function createTicket(input: CreateTicketInput) {
  const source = input.source ?? "quick_add";
  const text = maskIC(input.text).text;
  const conversation = await prisma.conversation.create({
    data: {
      channel: source,
      customerName: input.customerName?.trim() || "Unknown",
      customerContact: input.customerContact?.trim() || "",
    },
  });
  await prisma.message.create({ data: { conversationId: conversation.id, role: "customer", content: text } });
  return openTicket({
    conversationId: conversation.id,
    title: input.title,
    description: text,
    source,
    projectId: input.projectId,
    priority: input.priority,
    category: input.category,
  });
}

export async function ticketForIncomingMessage(conversationId: string, text: string) {
  const open = await prisma.ticket.findFirst({
    where: { conversationId, status: { in: OPEN_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (open) {
    return prisma.ticket.update({ where: { id: open.id }, data: { updatedAt: new Date() } });
  }
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { channel: true, customerId: true },
  });
  return openTicket({
    conversationId,
    description: text,
    source: conversation?.channel ?? "api",
    projectId: await followUpProjectId(conversationId, conversation?.customerId ?? null),
  });
}

// keep the thread in the project it was already in
async function followUpProjectId(conversationId: string, customerId: string | null): Promise<string | undefined> {
  const last = await prisma.ticket.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    select: { projectId: true },
  });
  if (last) return last.projectId;
  if (!customerId) return undefined;
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { projectId: true } });
  return customer?.projectId ?? undefined;
}
