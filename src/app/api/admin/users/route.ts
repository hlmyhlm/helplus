import { NextRequest, NextResponse } from "next/server";
import { prisma, systemPrisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { withAuth } from "@/lib/tenant/with-auth";
import { STAFF_ROLES } from "@/lib/rbac";
import { EMAIL_RE } from "@/lib/validations";

// usernames are unique across all companies, so say the same thing whoever owns the name
const USERNAME_TAKEN = { error: "Username already exists" };

export const GET = withAuth(
  "admin:read",
  async (request: NextRequest, _auth) => {
    try {
      const { searchParams } = new URL(request.url);
      const { page, limit, skip, take } = parsePagination(searchParams);

      const [users, total] = await Promise.all([
        prisma.admin.findMany({
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
          orderBy: { createdAt: "asc" },
          skip,
          take,
        }),
        prisma.admin.count(),
      ]);

      return NextResponse.json(paginatedResponse(users, total, page, limit));
    } catch (error) {
      logger.error("Failed to fetch admin users:", error);
      return NextResponse.json(
        { error: "Failed to fetch admin users" },
        { status: 500 }
      );
    }
  }
);

export const POST = withAuth(
  "admin:create",
  async (request: NextRequest, auth) => {
    try {
      const body = await request.json();
      const { username, password, name, role, email, notifyNew } = body;

      if (!username || typeof username !== "string" || username.trim().length === 0) {
        return NextResponse.json(
          { error: "Username is required" },
          { status: 400 }
        );
      }

      if (!password || typeof password !== "string" || password.length < 6) {
        return NextResponse.json(
          { error: "Password must be at least 6 characters" },
          { status: 400 }
        );
      }

      const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
      if (normalizedEmail && !EMAIL_RE.test(normalizedEmail)) {
        return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
      }

      const existing = await systemPrisma.admin.findUnique({
        where: { username: username.trim() },
      });
      if (existing) {
        return NextResponse.json(USERNAME_TAKEN, { status: 409 });
      }

      const userRole = (STAFF_ROLES as readonly string[]).includes(role) ? role : "staff";
      if (userRole === "owner" && auth.role !== "owner") {
        return NextResponse.json({ error: "Only an owner can add another owner" }, { status: 403 });
      }

      const hashed = await hashPassword(password);
      const user = await prisma.admin.create({
        data: {
          username: username.trim(),
          password: hashed,
          name: name?.trim() || username.trim(),
          role: userRole,
          email: normalizedEmail,
          notifyNew: !!notifyNew,
        },
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

      return NextResponse.json(user, { status: 201 });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        return NextResponse.json(USERNAME_TAKEN, { status: 409 });
      }
      logger.error("Failed to create admin user:", error);
      return NextResponse.json(
        { error: "Failed to create admin user" },
        { status: 500 }
      );
    }
  }
);
