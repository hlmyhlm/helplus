import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { STUCK_MINS } from "@/lib/notify/outbox";

const STATUSES = new Set(["pending", "sending", "sent", "failed"]);

export const GET = withAuth("emails:manage", async (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const { page, limit, skip, take } = parsePagination(params);
  const status = params.get("status") ?? "all";
  const where = STATUSES.has(status) ? { status } : {};
  const stuckSince = new Date(Date.now() - STUCK_MINS * 60_000);
  const [rows, total, stalePending] = await Promise.all([
    prisma.emailOutbox.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        to: true,
        subject: true,
        kind: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        sentAt: true,
        ticketId: true,
      },
    }),
    prisma.emailOutbox.count({ where }),
    // across all rows so the hint shows on any filter
    prisma.emailOutbox.count({ where: { status: { in: ["pending", "sending"] }, nextAttemptAt: { lt: stuckSince } } }),
  ]);
  return NextResponse.json({ ...paginatedResponse(rows, total, page, limit), stalePending });
});
