import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { allowedProjectIds, customerWhere } from "@/lib/tickets/access";

export const GET = withAuth(
  "customers:read",
  async (_request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const customer = await prisma.customer.findFirst({ where: { id, ...customerWhere(await allowedProjectIds(auth)) } });
      if (!customer) {
        return NextResponse.json(
          { error: "Customer not found" },
          { status: 404 }
        );
      }

      const notes = await prisma.customerNote.findMany({
        where: { customerId: id },
        orderBy: { createdAt: "desc" },
      });

      return NextResponse.json(notes);
    } catch (error) {
      logger.error("Failed to fetch customer notes:", error);
      return NextResponse.json(
        { error: "Failed to fetch customer notes" },
        { status: 500 }
      );
    }
  }
);

export const POST = withAuth(
  "customers:update",
  async (request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const { content, authorName } = body;

      if (!content || typeof content !== "string" || !content.trim()) {
        return NextResponse.json(
          { error: "Content is required" },
          { status: 400 }
        );
      }

      const customer = await prisma.customer.findFirst({ where: { id, ...customerWhere(await allowedProjectIds(auth)) } });
      if (!customer) {
        return NextResponse.json(
          { error: "Customer not found" },
          { status: 404 }
        );
      }

      const note = await prisma.customerNote.create({
        data: {
          customerId: id,
          content: content.trim(),
          authorName: authorName?.trim() || "Admin",
        },
      });

      return NextResponse.json(note, { status: 201 });
    } catch (error) {
      logger.error("Failed to create customer note:", error);
      return NextResponse.json(
        { error: "Failed to create customer note" },
        { status: 500 }
      );
    }
  }
);
