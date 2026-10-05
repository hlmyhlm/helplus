import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";

export const GET = withAuth(
  "tickets:read",
  async (_request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const ticket = await prisma.ticket.findUnique({
        where: { id },
        include: {
          conversation: {
            select: {
              id: true,
              customerName: true,
              customerContact: true,
              channel: true,
              status: true,
            },
          },
          department: {
            select: { id: true, name: true },
          },
          assignedTo: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      if (!ticket) {
        return NextResponse.json(
          { error: "Ticket not found" },
          { status: 404 }
        );
      }

      return NextResponse.json(ticket);
    } catch (error) {
      logger.error("Failed to fetch ticket:", error);
      return NextResponse.json(
        { error: "Failed to fetch ticket" },
        { status: 500 }
      );
    }
  }
);

export const PUT = withAuth(
  "tickets:update",
  async (request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const {
        title,
        description,
        status,
        priority,
        resolution,
        departmentId,
        assignedToId,
        conversationId,
      } = body;

      const existing = await prisma.ticket.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json(
          { error: "Ticket not found" },
          { status: 404 }
        );
      }

      const ticket = await prisma.ticket.update({
        where: { id },
        data: {
          ...(title !== undefined && { title: title.trim() }),
          ...(description !== undefined && { description: description.trim() }),
          ...(status !== undefined && { status }),
          ...(priority !== undefined && { priority }),
          ...(resolution !== undefined && { resolution: resolution.trim() }),
          ...(departmentId !== undefined && {
            departmentId: departmentId || null,
          }),
          ...(assignedToId !== undefined && {
            assignedToId: assignedToId || null,
          }),
          ...(conversationId !== undefined && {
            conversationId: conversationId || null,
          }),
        },
        include: {
          conversation: {
            select: {
              id: true,
              customerName: true,
              customerContact: true,
              channel: true,
              status: true,
            },
          },
          department: {
            select: { id: true, name: true },
          },
          assignedTo: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      return NextResponse.json(ticket);
    } catch (error) {
      logger.error("Failed to update ticket:", error);
      return NextResponse.json(
        { error: "Failed to update ticket" },
        { status: 500 }
      );
    }
  }
);

export const DELETE = withAuth(
  "tickets:delete",
  async (_request: NextRequest, _auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;

      const existing = await prisma.ticket.findUnique({ where: { id } });
      if (!existing) {
        return NextResponse.json(
          { error: "Ticket not found" },
          { status: 404 }
        );
      }

      await prisma.ticket.delete({ where: { id } });

      return NextResponse.json({ success: true });
    } catch (error) {
      logger.error("Failed to delete ticket:", error);
      return NextResponse.json(
        { error: "Failed to delete ticket" },
        { status: 500 }
      );
    }
  }
);
