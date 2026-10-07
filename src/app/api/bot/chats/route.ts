import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { allowedProjectIds } from "@/lib/tickets/access";
import { chatWhere } from "@/lib/bot/scope";

export const GET = withAuth("channels:read", async (_request, auth) => {
  try {
    const chats = await prisma.waChat.findMany({
      where: chatWhere(await allowedProjectIds(auth)),
      include: { project: { select: { name: true } } },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    });
    const counts = chats.length
      ? await prisma.waInbound.groupBy({
          by: ["chatId", "state"],
          where: { chatId: { in: chats.map((c) => c.id) }, state: { in: ["pending", "pick"] } },
          _count: { _all: true },
        })
      : [];
    const count = (chatId: string, state: string) =>
      counts.find((c) => c.chatId === chatId && c.state === state)?._count._all ?? 0;

    return NextResponse.json({
      data: chats.map((c) => ({
        id: c.id,
        name: c.name,
        isGroup: c.isGroup,
        projectId: c.projectId,
        projectName: c.project?.name ?? null,
        lastMessageAt: c.lastMessageAt,
        pending: count(c.id, "pending"),
        picks: count(c.id, "pick"),
      })),
    });
  } catch (error) {
    logger.error("Failed to list bot chats:", error);
    return NextResponse.json({ error: "Failed to list chats" }, { status: 500 });
  }
});
