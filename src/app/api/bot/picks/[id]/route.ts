import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { hasPermission } from "@/lib/rbac";
import { allowedProjectIds } from "@/lib/tickets/access";
import { placeReply } from "@/lib/bot/intake";
import { chatWhere } from "@/lib/bot/scope";

type Ctx = { params: Promise<{ id: string }> };

// placing a reply changes a ticket, so it needs tickets:update as well
export const POST = withAuth("channels:read", async (request: NextRequest, auth, { params }: Ctx) => {
  try {
    if (!hasPermission(auth.role, "tickets:update")) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Insufficient permissions" } }, { status: 403 });
    }
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const ticketId = (body as { ticketId?: unknown }).ticketId;
    if (ticketId !== null && (typeof ticketId !== "string" || !ticketId)) {
      return NextResponse.json({ error: "Pick a ticket, or null to ignore" }, { status: 400 });
    }

    const ids = await allowedProjectIds(auth);
    if (ids !== null) {
      const row = await prisma.waInbound.findFirst({ where: { id, chat: chatWhere(ids) }, select: { id: true } });
      if (!row) return NextResponse.json({ error: "Reply not found" }, { status: 404 });
    }

    const result = await placeReply(id, ticketId, auth.userId);
    if (result === "gone") {
      return NextResponse.json({ error: "Someone already placed this reply" }, { status: 409 });
    }
    return NextResponse.json({ result });
  } catch (error) {
    logger.error("Failed to place reply:", error);
    return NextResponse.json({ error: "Failed to place reply" }, { status: 500 });
  }
});
