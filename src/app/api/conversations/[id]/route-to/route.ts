import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { routeConversation } from "@/lib/conversation-engine";
import { logger } from "@/lib/logger";

export const POST = withAuth(
  "conversations:assign",
  async (request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { strategy, expertise, departmentId } = body;

      const result = await routeConversation(
        id,
        strategy || "skill_based",
        expertise,
        departmentId
      );

      if (!result) {
        return NextResponse.json(
          { error: "No available agents" },
          { status: 404 }
        );
      }

      return NextResponse.json(result);
    } catch (error) {
      logger.error("Failed to route conversation:", error);
      return NextResponse.json(
        { error: "Failed to route conversation" },
        { status: 500 }
      );
    }
  }
);
