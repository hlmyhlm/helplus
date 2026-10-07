import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { allowedProjectIds } from "@/lib/tickets/access";
import { projectProblem } from "@/lib/projects/usable";
import { chatWhere } from "@/lib/bot/scope";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth("channels:read", async (request: NextRequest, auth, { params }: Ctx) => {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const projectId = (body as { projectId?: unknown }).projectId;
    if (projectId !== null && (typeof projectId !== "string" || !projectId)) {
      return NextResponse.json({ error: "Pick a project, or null to unlink" }, { status: 400 });
    }

    const ids = await allowedProjectIds(auth);
    const chat = await prisma.waChat.findFirst({ where: { id, ...chatWhere(ids) }, select: { id: true } });
    if (!chat) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

    if (projectId !== null) {
      if (ids !== null && !ids.includes(projectId)) {
        return NextResponse.json({ error: { code: "FORBIDDEN", message: "Insufficient permissions" } }, { status: 403 });
      }
      const problem = await projectProblem(projectId);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    }

    if (projectId !== null) {
      return NextResponse.json(await prisma.waChat.update({ where: { id }, data: { projectId } }));
    }
    // messages waiting in an unlinked chat would never be picked up
    const [, saved] = await prisma.$transaction([
      prisma.waInbound.updateMany({
        where: { chatId: id, state: "pending" },
        data: { state: "ignored", doneAt: new Date() },
      }),
      prisma.waChat.update({ where: { id }, data: { projectId: null } }),
    ]);
    return NextResponse.json(saved);
  } catch (error) {
    logger.error("Failed to link bot chat:", error);
    return NextResponse.json({ error: "Failed to update chat" }, { status: 500 });
  }
});
