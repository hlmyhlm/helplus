import { NextRequest, NextResponse } from "next/server";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { channelKey } from "@/lib/tenant/keys";
import { saveSettings } from "@/lib/settings";
import {
  hashPassword,
  verifyPassword,
  generateToken,
  setAuthCookie,
  clearAuthCookie,
  getCurrentUser,
  isSetupComplete,
} from "@/lib/auth";

// POST /api/auth - Login or Setup
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, username, password, name } = body;

  if (action === "setup") {
    const setupDone = await isSetupComplete();
    if (setupDone) {
      return NextResponse.json(
        { error: "Setup already completed" },
        { status: 400 }
      );
    }

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    const hashed = await hashPassword(password);

    // first run: use the default company (it already holds any migrated data), or create it
    const company = await systemPrisma.company.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default", name: "My Company", slug: "default" },
    });

    const admin = await systemPrisma.admin.create({
      data: {
        username,
        password: hashed,
        name: name || "Admin",
        role: "owner",
        companyId: company.id,
      },
    });

    await runWithCompany(company.id, async () => {
      await saveSettings({});
      for (const type of ["whatsapp", "email", "phone"]) {
        await prisma.channel.upsert({
          where: channelKey(type),
          update: {},
          create: { type, isActive: false, status: "disconnected" },
        });
      }
    });

    const token = generateToken(admin.id, admin.role);
    const cookie = setAuthCookie(token);

    const response = NextResponse.json({
      success: true,
      user: { id: admin.id, username: admin.username, name: admin.name },
    });
    response.cookies.set(cookie);
    return response;
  }

  if (action === "login") {
    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      );
    }

    const admin = await systemPrisma.admin.findUnique({ where: { username } });
    if (!admin) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, admin.password);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const token = generateToken(admin.id, admin.role);
    const cookie = setAuthCookie(token);

    const response = NextResponse.json({
      success: true,
      user: { id: admin.id, username: admin.username, name: admin.name },
    });
    response.cookies.set(cookie);
    return response;
  }

  if (action === "logout") {
    const cookie = clearAuthCookie();
    const response = NextResponse.json({ success: true });
    response.cookies.set(cookie);
    return response;
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// GET /api/auth - Check auth status
export async function GET() {
  const setupDone = await isSetupComplete();
  if (!setupDone) {
    return NextResponse.json({ authenticated: false, setupRequired: true });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ authenticated: false, setupRequired: false });
  }

  return NextResponse.json({
    authenticated: true,
    setupRequired: false,
    user,
  });
}
