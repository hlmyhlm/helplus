import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { validateBody } from "@/lib/validations";

const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  name: z.string().trim().max(100).optional(),
});

export const GET = withAuth("business-hours:read", async () => {
  const data = await prisma.holiday.findMany({ orderBy: { date: "asc" } });
  return NextResponse.json({ data });
});

export const POST = withAuth("business-hours:update", async (request: NextRequest) => {
  const validation = validateBody(holidaySchema, await request.json());
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
  try {
    const holiday = await prisma.holiday.create({ data: { date: validation.data.date, name: validation.data.name ?? "" } });
    return NextResponse.json(holiday, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "That date is already a holiday" }, { status: 409 });
    }
    throw error;
  }
});
