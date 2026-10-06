import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { deleteCustomerData } from "@/lib/gdpr";
import { logger } from "@/lib/logger";

export const DELETE = withAuth(
  "customers:delete",
  async (request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { hardDelete } = body;

      const result = await deleteCustomerData(id, hardDelete === true);

      return NextResponse.json(result);
    } catch (error) {
      logger.error("Failed to delete customer data:", error);
      return NextResponse.json(
        { error: "Failed to delete data" },
        { status: 500 }
      );
    }
  }
);
