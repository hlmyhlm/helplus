import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { withAuth } from "@/lib/tenant/with-auth";

export const GET = withAuth(
  "webhooks:read",
  async (request: NextRequest, _auth) => {
    const { searchParams } = new URL(request.url);
    const { page, limit, skip, take } = parsePagination(searchParams);

    const [webhooks, total] = await Promise.all([
      prisma.webhook.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.webhook.count(),
    ]);

    return NextResponse.json(paginatedResponse(webhooks, total, page, limit));
  }
);

export const POST = withAuth(
  "webhooks:create",
  async (request: NextRequest, _auth) => {
    const body = await request.json();
    const { name, description, url, method, headers, triggerOn } = body;

    if (!name || !url || !triggerOn) {
      return NextResponse.json(
        { error: "Name, URL, and triggerOn are required" },
        { status: 400 }
      );
    }

    const webhook = await prisma.webhook.create({
      data: {
        name,
        description: description || "",
        url,
        method: method || "POST",
        headers: headers || {},
        triggerOn,
      },
    });

    return NextResponse.json(webhook, { status: 201 });
  }
);
