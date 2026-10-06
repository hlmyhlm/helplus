import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { OPEN_STATUSES } from "@/lib/tickets/status";
import { allowedProjectIds, projectWhere } from "@/lib/tickets/access";

export const GET = withAuth(
  "analytics:read",
  async (_request: NextRequest, auth) => {
    // conversation and message totals stay company-wide, they carry no content
    const ticketScope = projectWhere(await allowedProjectIds(auth));
    const [
      totalConversations,
      activeConversations,
      resolvedConversations,
      totalTickets,
      openTickets,
      totalMessages,
      channelBreakdown,
    ] = await Promise.all([
      prisma.conversation.count(),
      prisma.conversation.count({ where: { status: "active" } }),
      prisma.conversation.count({ where: { status: "resolved" } }),
      prisma.ticket.count({ where: ticketScope }),
      prisma.ticket.count({ where: { ...ticketScope, status: { in: OPEN_STATUSES } } }),
      prisma.message.count(),
      prisma.conversation.groupBy({
        by: ["channel"],
        _count: { id: true },
      }),
    ]);

    const resolutionRate =
      totalConversations > 0
        ? Math.round((resolvedConversations / totalConversations) * 100)
        : 0;

    const channels = channelBreakdown.reduce(
      (acc, item) => {
        acc[item.channel] = item._count.id;
        return acc;
      },
      {} as Record<string, number>
    );

    return NextResponse.json({
      totalConversations,
      activeConversations,
      resolvedConversations,
      totalTickets,
      openTickets,
      totalMessages,
      resolutionRate,
      channels,
    });
  }
);
