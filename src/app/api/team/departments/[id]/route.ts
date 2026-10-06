import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";

export const PUT = withAuth(
  "team:update",
  async (request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { name, description, email } = body;

      if (!name || !name.trim()) {
        return NextResponse.json(
          { error: "Department name is required" },
          { status: 400 }
        );
      }

      const department = await prisma.department.update({
        where: { id },
        data: {
          name: name.trim(),
          description: description?.trim() || "",
          email: email?.trim() || "",
        },
        include: {
          _count: {
            select: { members: true },
          },
        },
      });

      return NextResponse.json(department);
    } catch (error) {
      logger.error("Failed to update department:", error);
      return NextResponse.json(
        { error: "Failed to update department" },
        { status: 500 }
      );
    }
  }
);

export const DELETE = withAuth(
  "team:delete",
  async (_request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      await prisma.department.delete({
        where: { id },
      });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error("Failed to delete department:", error);
      return NextResponse.json(
        { error: "Failed to delete department" },
        { status: 500 }
      );
    }
  }
);
