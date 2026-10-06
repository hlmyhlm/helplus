import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { exportCustomerData } from "@/lib/gdpr";
import { logger } from "@/lib/logger";

export const GET = withAuth(
  "customers:export",
  async (_request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const data = await exportCustomerData(id);

      if (!data) {
        return NextResponse.json(
          { error: "Customer not found" },
          { status: 404 }
        );
      }

      return NextResponse.json(data);
    } catch (error) {
      logger.error("Failed to export customer data:", error);
      return NextResponse.json(
        { error: "Failed to export data" },
        { status: 500 }
      );
    }
  }
);
