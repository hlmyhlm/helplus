import type { Ticket, WaChat, WaInbound } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolveCustomer } from "@/lib/customer-resolver";
import { openTicket } from "@/lib/tickets/service";
import { saveTicket } from "@/lib/tickets/update";
import { statusChange, OPEN_STATUSES } from "@/lib/tickets/status";
import { addAttachment } from "@/lib/attachments/service";
import { MAX_BYTES } from "@/lib/attachments/client";
import { isAllowedImage } from "@/lib/privacy/ic-image";
import { fileStore } from "@/lib/storage";
import { decryptBuffer } from "@/lib/secrets";
import { defaultProjectId } from "@/lib/projects/default";
import { plan, placeUnquoted, senderDigits, FOLLOW_UP_MS, type OpenTicketLite } from "./rules";

const KEEP_MS = 7 * 86_400_000;
const MAX_ATTEMPTS = 5;
const PLACING_STALE_MS = 5 * 60_000;
const ANSWERABLE = ["new", "ai_suggested", "working", "reopened"];
const key = (waMessageId: string) => `wam:${waMessageId}`;
const isP2002 = (error: unknown) => (error as { code?: string })?.code === "P2002";
const inChat = (chatId: string) => ({ metadata: { path: ["waChatId"], equals: chatId } });

export async function runBotIntake(now: Date) {
  const stats = { tickets: 0, answers: 0, picks: 0 };
  // a placing that never finished goes back to the list
  await prisma.waInbound.updateMany({
    where: { state: "placing", doneAt: { lt: new Date(now.getTime() - PLACING_STALE_MS) } },
    data: { state: "pick", doneAt: null },
  });
  const chats = await prisma.waChat.findMany({
    where: { projectId: { not: null }, inbound: { some: { state: "pending" } } },
  });
  for (const chat of chats) {
    const rows = await prisma.waInbound.findMany({ where: { chatId: chat.id, state: "pending" }, orderBy: { at: "asc" } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const step of plan(rows, now)) {
      try {
        if (step.kind === "client") {
          if (await clientStep(chat, step.ids.map((id) => byId.get(id)!), now)) stats.tickets++;
        } else {
          const r = await staffStep(chat, byId.get(step.id)!, now);
          if (r === "answered") stats.answers++;
          if (r === "pick") stats.picks++;
        }
      } catch (error) {
        logger.error("bot intake step failed", error, { chatId: chat.id });
        const failed = step.kind === "client" ? step.ids.map((id) => byId.get(id)!) : [byId.get(step.id)!];
        await countFailure(chat.id, failed, step.kind === "client", now).catch((e) =>
          logger.error("couldn't count a bot failure", e)
        );
        // later replies could land on the wrong ticket without this one
        if (step.kind === "client") break;
      }
    }
  }
  return stats;
}

async function countFailure(chatId: string, rows: WaInbound[], isClient: boolean, now: Date): Promise<void> {
  const ids = rows.map((r) => r.id);
  await prisma.waInbound.updateMany({ where: { id: { in: ids }, state: "pending" }, data: { attempts: { increment: 1 } } });
  const given = await prisma.waInbound.findMany({
    where: { id: { in: ids }, state: "pending", attempts: { gte: MAX_ATTEMPTS } },
    select: { id: true, waMessageId: true, at: true },
  });
  if (!given.length) return;
  const saved = isClient
    ? await prisma.message.findFirst({
        where: { importKey: { in: given.map((r) => key(r.waMessageId)) } },
        select: { conversation: { select: { tickets: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } } } },
      })
    : null;
  const ticketId = saved?.conversation.tickets[0]?.id ?? null;
  await prisma.waInbound.updateMany({
    where: { id: { in: given.map((r) => r.id) }, state: "pending" },
    data: { state: "failed", doneAt: now, ...(ticketId ? { ticketId } : {}) },
  });
  logger.error("bot rows kept failing, giving up", undefined, { ids, ticketId });
  if (!isClient) return;
  // replies held behind them can't be placed by rules any more
  const from = new Date(Math.min(...given.map((r) => r.at.getTime())));
  await prisma.waInbound.updateMany({
    where: { chatId, state: "pending", isStaff: true, at: { gte: from } },
    data: { state: "pick" },
  });
}

// open tickets of this chat with the latest whatsapp time seen on each
async function openInChat(chatId: string, customerId?: string): Promise<OpenTicketLite[]> {
  const tickets = await prisma.ticket.findMany({
    where: { status: { in: OPEN_STATUSES }, conversation: { ...inChat(chatId), ...(customerId ? { customerId } : {}) } },
    select: { id: true },
  });
  if (!tickets.length) return [];
  const last = await prisma.waInbound.groupBy({
    by: ["ticketId"],
    where: { ticketId: { in: tickets.map((t) => t.id) }, state: "done" },
    _max: { at: true },
  });
  return last
    .filter((l) => l.ticketId && l._max.at)
    .map((l) => ({ id: l.ticketId!, lastActivityAt: l._max.at! }));
}

async function quotedTicket(chatId: string, quoted: string[], customerId?: string): Promise<Ticket | null> {
  if (!quoted.length) return null;
  return prisma.ticket.findFirst({
    where: {
      status: { in: OPEN_STATUSES },
      conversation: {
        ...inChat(chatId),
        ...(customerId ? { customerId } : {}),
        messages: { some: { importKey: { in: quoted.map(key) } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

// returns true when it opened a new ticket
async function clientStep(chat: WaChat, rows: WaInbound[], now: Date): Promise<boolean> {
  const first = rows[0];
  const contact = senderDigits(first.senderId);
  const customerId = await resolveCustomer("whatsapp", contact, first.senderName);
  await prisma.customer.updateMany({ where: { id: customerId, projectId: null }, data: { projectId: chat.projectId } });

  let ticket = await quotedTicket(chat.id, rows.flatMap((r) => (r.quotedWaId ? [r.quotedWaId] : [])), customerId);
  if (!ticket) {
    const recent = (await openInChat(chat.id, customerId))
      .filter((t) => first.at.getTime() - t.lastActivityAt.getTime() < FOLLOW_UP_MS)
      .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())[0];
    if (recent) ticket = await prisma.ticket.findUnique({ where: { id: recent.id } });
  }

  let opened = false;
  let conversationId = ticket?.conversationId ?? null;
  if (!ticket) {
    // a retried step finds the messages it already saved
    const saved = await prisma.message.findFirst({
      where: { importKey: { in: rows.map((r) => key(r.waMessageId)) } },
      select: { conversationId: true },
    });
    conversationId = saved?.conversationId ?? null;
    if (conversationId) ticket = await prisma.ticket.findFirst({ where: { conversationId }, orderBy: { createdAt: "desc" } });
    else {
      const conversation = await prisma.conversation.create({
        data: {
          channel: "whatsapp",
          customerName: first.senderName || "Unknown",
          customerContact: contact,
          customerId,
          metadata: { waChatId: chat.id, waChatName: chat.name },
        },
      });
      conversationId = conversation.id;
    }
  }

  const messageIds = await saveMessages(conversationId!, rows, "customer");
  if (!ticket) {
    ticket = await openTicket({
      conversationId: conversationId!,
      description: rows.map((r) => r.text).filter(Boolean).join("\n") || "[image]",
      source: chat.isGroup ? "whatsapp_group" : "whatsapp",
      projectId: await chatProject(chat.projectId!),
    });
    opened = true;
  } else if (ticket.status === "answered" || ticket.status === "ai_suggested") {
    // the client wrote back, so it needs staff again
    await saveTicket(ticket, statusChange(ticket, "working"));
  } else {
    await prisma.ticket.update({ where: { id: ticket.id }, data: { updatedAt: new Date() } });
  }

  for (const r of rows) await attachImage(r, ticket.id, messageIds.get(r.id) ?? null);
  await prisma.waInbound.updateMany({
    // an unlink may have set them to ignored meanwhile
    where: { id: { in: rows.map((r) => r.id) }, state: "pending" },
    data: { state: "done", ticketId: ticket.id, doneAt: now },
  });
  return opened;
}

async function chatProject(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { archived: true } });
  return project && !project.archived ? projectId : defaultProjectId();
}

// skips messages a dead run already saved
async function saveMessages(conversationId: string, rows: WaInbound[], role: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const r of rows) {
    const importKey = key(r.waMessageId);
    try {
      const m = await prisma.message.create({
        data: { conversationId, role, content: r.text || "[image]", importKey, createdAt: r.at },
      });
      ids.set(r.id, m.id);
    } catch (error) {
      if (!isP2002(error)) throw error;
      const m = await prisma.message.findFirst({ where: { importKey }, select: { id: true } });
      if (m) ids.set(r.id, m.id);
    }
  }
  return ids;
}

// best effort: a bad image never holds up the message
async function attachImage(row: WaInbound, ticketId: string, messageId: string | null): Promise<void> {
  if (!row.mediaKey) return;
  try {
    const already = messageId ? await prisma.attachment.count({ where: { messageId } }) : 0;
    const data = already ? null : decryptBuffer(await fileStore().get(row.mediaKey));
    if (data && data.length <= MAX_BYTES && (await isAllowedImage(data))) {
      await addAttachment({ ticketId, messageId, fileName: row.mediaName || "whatsapp-image.jpg", data }, { process: false });
    }
  } catch (error) {
    logger.error("couldn't attach a bot image", error, { inboundId: row.id });
  }
  await fileStore().remove(row.mediaKey).catch(() => {});
  await prisma.waInbound.update({ where: { id: row.id }, data: { mediaKey: null } });
}

async function staffStep(chat: WaChat, row: WaInbound, now: Date): Promise<"answered" | "pick" | "ignored"> {
  const quoted = await quotedTicket(chat.id, row.quotedWaId ? [row.quotedWaId] : []);
  let ticketId = quoted?.id ?? null;
  if (!ticketId) {
    const placed = placeUnquoted(await openInChat(chat.id), row.at);
    if (placed === "pick") {
      await prisma.waInbound.updateMany({ where: { id: row.id, state: "pending" }, data: { state: "pick" } });
      return "pick";
    }
    if (placed === "ignore") {
      await prisma.waInbound.updateMany({ where: { id: row.id, state: "pending" }, data: { state: "ignored", doneAt: now } });
      return "ignored";
    }
    ticketId = placed.ticketId;
  }
  await answer(ticketId, row, now);
  return "answered";
}

async function answer(ticketId: string, row: WaInbound, now: Date, actorId?: string): Promise<void> {
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const messageIds = await saveMessages(ticket.conversationId!, [row], "agent");
  await attachImage(row, ticket.id, messageIds.get(row.id) ?? null);
  if (ANSWERABLE.includes(ticket.status)) {
    await saveTicket(ticket, statusChange(ticket, "answered"), actorId ? { actorId } : {});
  }
  await prisma.waInbound.updateMany({
    where: { id: row.id, state: { in: ["pending", "placing"] } },
    data: { state: "done", ticketId: ticket.id, doneAt: now },
  });
}

export async function placeReply(
  inboundId: string,
  ticketId: string | null,
  actorId?: string
): Promise<"placed" | "ignored" | "gone"> {
  const now = new Date();
  const { count } = await prisma.waInbound.updateMany({
    where: { id: inboundId, state: "pick" },
    data: { state: "placing", doneAt: now },
  });
  if (!count) return "gone";
  const release = () =>
    prisma.waInbound.updateMany({ where: { id: inboundId, state: "placing" }, data: { state: "pick", doneAt: null } });

  if (!ticketId) {
    await prisma.waInbound.updateMany({ where: { id: inboundId, state: "placing" }, data: { state: "ignored", doneAt: now } });
    return "ignored";
  }
  try {
    const row = await prisma.waInbound.findUniqueOrThrow({ where: { id: inboundId } });
    const ticket = await prisma.ticket.findFirst({
      where: { id: ticketId, status: { in: OPEN_STATUSES }, conversation: inChat(row.chatId) },
      select: { id: true },
    });
    if (!ticket) {
      await release();
      return "gone";
    }
    await answer(ticket.id, row, now, actorId);
    return "placed";
  } catch (error) {
    // keep the real error if the release fails too
    await release().catch((e) => logger.error("couldn't release a reply to place", e));
    throw error;
  }
}

export async function cleanBotInbound(now: Date): Promise<number> {
  const old = await prisma.waInbound.findMany({
    where: { state: { in: ["done", "ignored", "failed"] }, doneAt: { lt: new Date(now.getTime() - KEEP_MS) } },
    select: { id: true, mediaKey: true },
    take: 500,
  });
  for (const r of old) if (r.mediaKey) await fileStore().remove(r.mediaKey).catch(() => {});
  const { count } = await prisma.waInbound.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
  return count;
}
