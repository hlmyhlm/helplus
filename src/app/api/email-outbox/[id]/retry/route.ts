import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth("emails:manage", async (_request: NextRequest, _auth, { params }: Ctx) => {
  const { id } = await params;
  const row = await prisma.emailOutbox.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Email not found" }, { status: 404 });
  if (row.status === "sent" || row.status === "sending") {
    return NextResponse.json({ error: "Can't retry this email right now" }, { status: 409 });
  }
  const updated = await prisma.emailOutbox.update({
    where: { id },
    data: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: "" },
  });
  return NextResponse.json(updated);
});
