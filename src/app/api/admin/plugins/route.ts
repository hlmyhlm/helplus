import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { getPlugins } from "@/lib/plugins";
import { logger } from "@/lib/logger";

export const GET = withAuth(
  "admin:read",
  async (_request: NextRequest, _auth) => {
    try {
      const plugins = getPlugins();
      return NextResponse.json(plugins);
    } catch (error) {
      logger.error("Failed to fetch plugins:", error);
      return NextResponse.json(
        { error: "Failed to fetch plugins" },
        { status: 500 }
      );
    }
  }
);
