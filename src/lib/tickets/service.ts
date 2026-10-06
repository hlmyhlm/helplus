import { prisma } from "@/lib/prisma";
import { maskIC } from "@/lib/privacy/ic-mask";
import { defaultProjectId } from "@/lib/projects/default";
import { nextTicketNumber } from "./number";
import { OPEN_STATUSES } from "./status";
import { loadSlaContext, saveTicket } from "./update";
import { statusChange } from "./status";
import { pickRule } from "@/lib/sla/rules";
import { slaTimes } from "@/lib/sla/clock";
import { notifyTicket } from "@/lib/notify/notify";

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

// no transaction, the link check can't see uncommitted rows
export async function openTicket(input: OpenTicketInput) {
  const description = maskIC(input.description).text;
  const title = maskIC(input.title?.trim() || titleFrom(description)).text;
  const now = new Date();
  const match = {
    projectId: input.projectId || (await defaultProjectId()),
    priority: input.priority ?? "medium",
    category: input.category ?? "",
    source: input.source,
  };
  const ctx = await loadSlaContext();
  const ticket = await prisma.ticket.create({
    data: {
      number: await nextTicketNumber(),
      title,
      description,
      ...match,
      status: "new",
      conversationId: input.conversationId,
      createdAt: now,
      ...slaTimes(now, 0, pickRule(ctx.rules, match), ctx.cal),
    },
  });
  await notifyTicket("new_ticket", ticket);
  return ticket;
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
    // the client wrote back, so it needs staff again
    if (open.status === "answered" || open.status === "ai_suggested") {
      return saveTicket(open, statusChange(open, "working"));
    }
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

// keep the thread in the project it was already in, unless that project is archived
async function followUpProjectId(conversationId: string, customerId: string | null): Promise<string | undefined> {
  const last = await prisma.ticket.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    select: { projectId: true, project: { select: { archived: true } } },
  });
  if (last && !last.project.archived) return last.projectId;
  if (!customerId) return undefined;
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { projectId: true, project: { select: { archived: true } } },
  });
  return customer?.projectId && !customer.project?.archived ? customer.projectId : undefined;
}
