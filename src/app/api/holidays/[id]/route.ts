import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withAuth("business-hours:update", async (_request: NextRequest, _auth, { params }: Ctx) => {
  const { id } = await params;
  if (!(await prisma.holiday.findUnique({ where: { id } }))) {
    return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
  }
  await prisma.holiday.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
