import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { getSettings } from "@/lib/settings";
import { hasPermission } from "@/lib/rbac";
import type { AuthContext } from "@/lib/route-auth";

// small details every staff screen needs
export const GET = withAuth(undefined, async (_request: NextRequest, auth: AuthContext) => {
  const [company, settings] = await Promise.all([
    prisma.company.findFirst({ select: { name: true, slug: true } }),
    getSettings(),
  ]);
  return NextResponse.json({
    name: company?.name ?? "",
    slug: company?.slug ?? "",
    projectLabel: settings.projectLabel,
    canManageProjects: hasPermission(auth.role, "projects:manage"),
    canCheckScreens: hasPermission(auth.role, "attachments:original"),
    canUpdateTickets: hasPermission(auth.role, "tickets:update"),
    canImport: hasPermission(auth.role, "imports:run"),
    autoCloseDays: settings.autoCloseDays,
  });
});
