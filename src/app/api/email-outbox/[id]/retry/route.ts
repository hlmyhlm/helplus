import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth("emails:manage", async (_request: NextRequest, _auth, { params }: Ctx) => {
  const { id } = await params;
  // guarded so it can't reset a row the worker is sending
  const { count } = await prisma.emailOutbox.updateMany({
    where: { id, status: { in: ["pending", "failed"] } },
    data: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: "" },
  });
  const row = await prisma.emailOutbox.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Email not found" }, { status: 404 });
  if (!count) return NextResponse.json({ error: "Can't retry this email right now" }, { status: 409 });
  return NextResponse.json(row);
});
