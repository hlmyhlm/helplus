import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { STAFF_ROLES } from "@/lib/rbac";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PUT = withAuth(
  "admin:update",
  async (request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { name, role, password, email, notifyNew } = body;

      if (email !== undefined && typeof email === "string" && email.trim() && !EMAIL_RE.test(email.trim())) {
        return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
      }

      const existing = await prisma.admin.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      // owner accounts can only be touched by another owner, for any field
      if (existing.role === "owner" && auth.role !== "owner") {
        return NextResponse.json({ error: "Only an owner can change an owner account" }, { status: 403 });
      }

      const updateData: Record<string, unknown> = {};

      if (name !== undefined) {
        updateData.name = name.trim();
      }

      if (role !== undefined) {
        if ((STAFF_ROLES as readonly string[]).includes(role)) {
          if (role === "owner" && auth.role !== "owner") {
            return NextResponse.json({ error: "Only an owner can add another owner" }, { status: 403 });
          }
          // Prevent removing the last owner
          if (existing.role === "owner" && role !== "owner") {
            const ownerCount = await prisma.admin.count({
              where: { role: "owner" },
            });
            if (ownerCount <= 1) {
              return NextResponse.json(
                { error: "Cannot change role of the last owner user" },
                { status: 400 }
              );
            }
          }
          updateData.role = role;
        }
      }

      if (password && typeof password === "string" && password.length >= 6) {
        updateData.password = await hashPassword(password);
      }

      if (email !== undefined && typeof email === "string") {
        updateData.email = email.trim().toLowerCase();
      }

      if (notifyNew !== undefined) {
        updateData.notifyNew = !!notifyNew;
      }

      const user = await prisma.admin.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
          email: true,
          notifyNew: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return NextResponse.json(user);
    } catch (error) {
      logger.error("Failed to update admin user:", error);
      return NextResponse.json(
        { error: "Failed to update admin user" },
        { status: 500 }
      );
    }
  }
);

export const DELETE = withAuth(
  "admin:delete",
  async (_request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const existing = await prisma.admin.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      // owner accounts can only be deleted by another owner
      if (existing.role === "owner" && auth.role !== "owner") {
        return NextResponse.json({ error: "Only an owner can delete an owner account" }, { status: 403 });
      }

      const ownerCount = await prisma.admin.count({ where: { role: "owner" } });
      if (existing.role === "owner" && ownerCount <= 1) {
        return NextResponse.json(
          { error: "Cannot delete the last owner user" },
          { status: 400 }
        );
      }

      await prisma.admin.delete({ where: { id } });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error("Failed to delete admin user:", error);
      return NextResponse.json(
        { error: "Failed to delete admin user" },
        { status: 500 }
      );
    }
  }
);
