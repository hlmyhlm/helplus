import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import type { AuthContext } from "@/lib/route-auth";
import { allowedProjectIds, projectWhere } from "@/lib/tickets/access";
import { maskIC } from "@/lib/privacy/ic-mask";
import { hasPermission } from "@/lib/rbac";

type Ctx = { params: Promise<{ id: string }> };

async function findDraft(auth: AuthContext, id: string) {
  const ids = await allowedProjectIds(auth);
  const draft = await prisma.knowledgeEntry.findFirst({ where: { id, status: "draft", ...projectWhere(ids) } });
  if (draft) return { draft };
  // tell "already approved" apart from "not yours or gone"
  const other = await prisma.knowledgeEntry.findFirst({ where: { id, ...projectWhere(ids) }, select: { id: true } });
  return {
    error: other
      ? NextResponse.json({ error: "This entry is already approved" }, { status: 409 })
      : NextResponse.json({ error: "Draft not found" }, { status: 404 }),
  };
}

export const PATCH = withAuth("knowledge:update", async (request: NextRequest, auth, { params }: Ctx) => {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { title, content, categoryId } = body as { title?: unknown; content?: unknown; categoryId?: unknown };

    const found = await findDraft(auth, id);
    if (found.error) return found.error;

    if (title !== undefined && (typeof title !== "string" || !title.trim())) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (content !== undefined && typeof content !== "string") {
      return NextResponse.json({ error: "Content must be text" }, { status: 400 });
    }
    if (categoryId !== undefined) {
      if (typeof categoryId !== "string" || !(await prisma.category.findFirst({ where: { id: categoryId }, select: { id: true } }))) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }
    }

    const draft = await prisma.knowledgeEntry.update({
      where: { id },
      data: {
        ...(typeof title === "string" && { title: maskIC(title.trim()).text }),
        ...(typeof content === "string" && { content: maskIC(content.trim()).text }),
        ...(typeof categoryId === "string" && { categoryId }),
        version: { increment: 1 },
      },
    });
    return NextResponse.json(draft);
  } catch (error) {
    logger.error("Failed to update draft:", error);
    return NextResponse.json({ error: "Failed to update draft" }, { status: 500 });
  }
});

// approve needs knowledge:update, reject also needs knowledge:delete
export const POST = withAuth("knowledge:update", async (request: NextRequest, auth, { params }: Ctx) => {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = (body as { action?: unknown }).action;
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "Action must be approve or reject" }, { status: 400 });
    }
    if (action === "reject" && !hasPermission(auth.role, "knowledge:delete")) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Insufficient permissions" } }, { status: 403 });
    }

    const found = await findDraft(auth, id);
    if (found.error) return found.error;

    if (action === "reject") {
      await prisma.knowledgeEntry.delete({ where: { id } });
      return NextResponse.json({ success: true });
    }
    const entry = await prisma.knowledgeEntry.update({ where: { id }, data: { status: "approved", isActive: true } });
    return NextResponse.json(entry);
  } catch (error) {
    logger.error("Failed to approve or reject draft:", error);
    return NextResponse.json({ error: "Failed to update draft" }, { status: 500 });
  }
});
