import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import type { AuthContext } from "@/lib/route-auth";
import { allowedProjectIds, projectWhere } from "@/lib/tickets/access";
import { maskIC } from "@/lib/privacy/ic-mask";
import { hasPermission } from "@/lib/rbac";

type Ctx = { params: Promise<{ id: string }> };

// every write only matches a draft the user can see, so a race can't touch an approved entry
async function draftWhere(auth: AuthContext, id: string) {
  const ids = await allowedProjectIds(auth);
  return { ids, where: { id, status: "draft", ...projectWhere(ids) } };
}

// the write matched nothing: tell "already approved" apart from "not yours or gone"
async function missing(ids: string[] | null, id: string) {
  const other = await prisma.knowledgeEntry.findFirst({
    where: { id, ...projectWhere(ids) },
    select: { id: true },
  });
  return other
    ? NextResponse.json({ error: "This entry is already approved" }, { status: 409 })
    : NextResponse.json({ error: "Draft not found" }, { status: 404 });
}

function badText(value: unknown, name: string, max: number): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) return `${name} is required`;
  if (value.trim().length > max) return `${name} is too long (max ${max})`;
  return null;
}

export const PATCH = withAuth(
  "knowledge:update",
  async (request: NextRequest, auth, { params }: Ctx) => {
    try {
      const { id } = await params;
      const body = await request.json().catch(() => ({}));
      const { title, content, categoryId } = body as {
        title?: unknown;
        content?: unknown;
        categoryId?: unknown;
      };

      // same limits as a normal entry
      const invalid = badText(title, "Title", 500) ?? badText(content, "Content", 100000);
      if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
      if (categoryId !== undefined) {
        if (
          typeof categoryId !== "string" ||
          !(await prisma.category.findFirst({ where: { id: categoryId }, select: { id: true } }))
        ) {
          return NextResponse.json({ error: "Category not found" }, { status: 400 });
        }
      }

      const { ids, where } = await draftWhere(auth, id);
      const { count } = await prisma.knowledgeEntry.updateMany({
        where,
        data: {
          ...(typeof title === "string" && { title: maskIC(title.trim()).text }),
          ...(typeof content === "string" && { content: maskIC(content.trim()).text }),
          ...(typeof categoryId === "string" && { categoryId }),
          version: { increment: 1 },
        },
      });
      if (count === 0) return missing(ids, id);

      const saved = await prisma.knowledgeEntry.findFirst({ where: { id } });
      if (!saved) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
      return NextResponse.json(saved);
    } catch (error) {
      logger.error("Failed to update draft:", error);
      return NextResponse.json({ error: "Failed to update draft" }, { status: 500 });
    }
  }
);

// approve needs knowledge:update, reject also needs knowledge:delete
export const POST = withAuth(
  "knowledge:update",
  async (request: NextRequest, auth, { params }: Ctx) => {
    try {
      const { id } = await params;
      const body = await request.json().catch(() => ({}));
      const action = (body as { action?: unknown }).action;
      if (action !== "approve" && action !== "reject") {
        return NextResponse.json({ error: "Action must be approve or reject" }, { status: 400 });
      }
      if (action === "reject" && !hasPermission(auth.role, "knowledge:delete")) {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
          { status: 403 }
        );
      }

      const { ids, where } = await draftWhere(auth, id);
      const { count } =
        action === "reject"
          ? await prisma.knowledgeEntry.deleteMany({ where })
          : await prisma.knowledgeEntry.updateMany({
              where,
              data: { status: "approved", isActive: true },
            });
      if (count === 0) return missing(ids, id);

      return NextResponse.json(
        action === "reject" ? { success: true } : { id, status: "approved", isActive: true }
      );
    } catch (error) {
      logger.error("Failed to approve or reject draft:", error);
      return NextResponse.json({ error: "Failed to update draft" }, { status: 500 });
    }
  }
);
