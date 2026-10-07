import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { allowedProjectIds, projectWhere } from "@/lib/tickets/access";
import { OPEN_STATUSES } from "@/lib/tickets/status";
import { chatWhere } from "@/lib/bot/scope";

type Option = { ticketId: string; number: number; title: string; status: string };

export const GET = withAuth("channels:read", async (_request, auth) => {
  try {
    const ids = await allowedProjectIds(auth);
    const rows = await prisma.waInbound.findMany({
      where: { state: "pick", chat: chatWhere(ids) },
      include: { chat: { select: { name: true } } },
      orderBy: { at: "asc" },
      take: 100,
    });

    const options = new Map<string, Option[]>();
    for (const chatId of new Set(rows.map((r) => r.chatId))) {
      const tickets = await prisma.ticket.findMany({
        where: {
          status: { in: OPEN_STATUSES },
          ...projectWhere(ids),
          conversation: { metadata: { path: ["waChatId"], equals: chatId } },
        },
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: { id: true, number: true, title: true, status: true },
      });
      options.set(chatId, tickets.map((t) => ({ ticketId: t.id, number: t.number, title: t.title, status: t.status })));
    }

    return NextResponse.json({
      data: rows.map((r) => ({
        id: r.id,
        chatName: r.chat.name,
        senderName: r.senderName,
        text: r.text,
        at: r.at,
        options: options.get(r.chatId) ?? [],
      })),
    });
  } catch (error) {
    logger.error("Failed to list replies to place:", error);
    return NextResponse.json({ error: "Failed to list replies" }, { status: 500 });
  }
});
