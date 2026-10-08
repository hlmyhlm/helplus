import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { withAuth } from "@/lib/tenant/with-auth";
import { allowedProjectIds, conversationWhere } from "@/lib/tickets/access";

export const GET = withAuth(
  "conversations:read",
  async (request: NextRequest, auth) => {
    try {
      const { searchParams } = new URL(request.url);
      const { page, limit, skip, take } = parsePagination(searchParams);
      const channel = searchParams.get("channel");
      const status = searchParams.get("status");
      const search = searchParams.get("search");

      const where: Record<string, unknown> = conversationWhere(await allowedProjectIds(auth));

      if (channel && channel !== "all") {
        where.channel = channel;
      }

      if (status && status !== "all") {
        where.status = status;
      }

      if (search && search.trim()) {
        where.OR = [
          { customerName: { contains: search.trim(), mode: "insensitive" } },
          { customerContact: { contains: search.trim(), mode: "insensitive" } },
        ];
      }

      const [conversations, total] = await Promise.all([
        prisma.conversation.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          skip,
          take,
          include: {
            messages: {
              take: 1,
              orderBy: { createdAt: "desc" },
            },
            _count: {
              select: { messages: true },
            },
            tags: {
              include: { tag: true },
            },
          },
        }),
        prisma.conversation.count({ where }),
      ]);

      return NextResponse.json(paginatedResponse(conversations, total, page, limit));
    } catch (error) {
      logger.error("Failed to fetch conversations:", error);
      return NextResponse.json(
        { error: "Failed to fetch conversations" },
        { status: 500 }
      );
    }
  }
);

export const POST = withAuth(
  "conversations:create",
  async (request: NextRequest, auth) => {
    try {
      // limited users can't create a thread outside their projects
      if ((await allowedProjectIds(auth)) !== null) {
        return NextResponse.json({ error: "Use quick add on the Tickets page" }, { status: 403 });
      }

      const body = await request.json();
      const { channel, customerName, customerContact, status } = body;

      if (!channel || typeof channel !== "string") {
        return NextResponse.json(
          { error: "Channel is required" },
          { status: 400 }
        );
      }

      const conversation = await prisma.conversation.create({
        data: {
          channel: channel.trim(),
          customerName: customerName?.trim() || "Unknown",
          customerContact: customerContact?.trim() || "",
          status: status || "active",
        },
        include: {
          messages: {
            take: 1,
            orderBy: { createdAt: "desc" },
          },
          _count: {
            select: { messages: true },
          },
          tags: {
            include: { tag: true },
          },
        },
      });

      return NextResponse.json(conversation, { status: 201 });
    } catch (error) {
      logger.error("Failed to create conversation:", error);
      return NextResponse.json(
        { error: "Failed to create conversation" },
        { status: 500 }
      );
    }
  }
);
