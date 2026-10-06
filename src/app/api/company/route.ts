import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { getSettings } from "@/lib/settings";

// small, non-secret details every staff screen needs (settings itself is admin-only)
export const GET = withAuth(undefined, async (_request: NextRequest) => {
  const [company, settings] = await Promise.all([
    prisma.company.findFirst({ select: { name: true, slug: true } }),
    getSettings(),
  ]);
  return NextResponse.json({
    name: company?.name ?? "",
    slug: company?.slug ?? "",
    projectLabel: settings.projectLabel,
  });
});
