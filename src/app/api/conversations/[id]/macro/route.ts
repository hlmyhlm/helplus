import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { executeMacro } from "@/lib/conversation-engine";
import { logger } from "@/lib/logger";

export const POST = withAuth(
  "conversations:update",
  async (request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { actions } = body;

      if (!actions || !Array.isArray(actions)) {
        return NextResponse.json(
          { error: "actions array is required" },
          { status: 400 }
        );
      }

      const result = await executeMacro(id, actions, auth.name);

      return NextResponse.json(result);
    } catch (error) {
      logger.error("Failed to execute macro:", error);
      return NextResponse.json(
        { error: "Failed to execute macro" },
        { status: 500 }
      );
    }
  }
);
