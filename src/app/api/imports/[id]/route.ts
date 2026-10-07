import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { JOB_FIELDS, jobWhere } from "@/lib/imports/access";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth("imports:run", async (_request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const job = await prisma.importJob.findFirst({
    where: { id, ...(await jobWhere(auth)) },
    select: { ...JOB_FIELDS, preview: true },
  });
  if (!job) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  return NextResponse.json({ data: job });
});
