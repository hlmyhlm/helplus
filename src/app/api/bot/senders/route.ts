import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { allowedProjectIds } from "@/lib/tickets/access";
import { currentCompanyId } from "@/lib/tenant/context";
import { maskIC } from "@/lib/privacy/ic-mask";
import { chatWhere } from "@/lib/bot/scope";
import { phoneDigits, senderDigits } from "@/lib/bot/rules";

const DAYS_30 = 30 * 86_400_000;

export const GET = withAuth("channels:read", async (request: NextRequest, auth) => {
  try {
    const chatId = request.nextUrl.searchParams.get("chatId");
    if (!chatId) return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    const chat = await prisma.waChat.findFirst({
      where: { id: chatId, ...chatWhere(await allowedProjectIds(auth)) },
      select: { id: true },
    });
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

    const rows = await prisma.waInbound.groupBy({
      by: ["senderId", "senderName"],
      where: { chatId, at: { gte: new Date(Date.now() - DAYS_30) } },
      _max: { at: true },
    });
    const [team, marked] = await Promise.all([
      prisma.teamMember.findMany({ select: { phone: true } }),
      prisma.chatSender.findMany({
        where: { name: { in: [...new Set(rows.map((r) => r.senderName))] } },
        select: { name: true, isStaff: true },
      }),
    ]);
    const phones = new Set(team.map((t) => phoneDigits(t.phone)).filter(Boolean));
    const staffNames = new Set(marked.filter((s) => s.isStaff).map((s) => s.name));

    // one line per name, even if it wrote from more than one number
    const byName = new Map<string, { name: string; fromTeam: boolean; lastAt: Date }>();
    for (const r of rows) {
      const digits = senderDigits(r.senderId);
      const fromTeam = digits !== "" && phones.has(digits);
      const at = r._max.at ?? new Date(0);
      const seen = byName.get(r.senderName);
      if (!seen) byName.set(r.senderName, { name: r.senderName, fromTeam, lastAt: at });
      else {
        seen.fromTeam ||= fromTeam;
        if (at > seen.lastAt) seen.lastAt = at;
      }
    }

    const data = [...byName.values()]
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
      .map((s) => ({ name: s.name, staff: s.fromTeam || staffNames.has(s.name), fromTeam: s.fromTeam, lastAt: s.lastAt }));
    return NextResponse.json({ data });
  } catch (error) {
    logger.error("Failed to list bot senders:", error);
    return NextResponse.json({ error: "Failed to list senders" }, { status: 500 });
  }
});

export const PATCH = withAuth("channels:read", async (request: NextRequest) => {
  try {
    const body = await request.json().catch(() => ({}));
    const { name, staff } = body as { name?: unknown; staff?: unknown };
    if (typeof name !== "string" || !name.trim() || typeof staff !== "boolean") {
      return NextResponse.json({ error: "Send a name and staff true or false" }, { status: 400 });
    }
    // same masking and length the bot uses when it saves a sender
    const masked = maskIC(name.trim()).text.slice(0, 120);
    await prisma.chatSender.upsert({
      where: { companyId_name: { companyId: currentCompanyId(), name: masked } },
      create: { name: masked, isStaff: staff },
      update: { isStaff: staff },
    });
    return NextResponse.json({ name: masked, staff });
  } catch (error) {
    logger.error("Failed to update bot sender:", error);
    return NextResponse.json({ error: "Failed to update sender" }, { status: 500 });
  }
});
