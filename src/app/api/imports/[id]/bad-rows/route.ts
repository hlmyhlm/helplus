import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { loadJobFor } from "@/lib/imports/access";
import { badRowsCsv, type BadRow } from "@/lib/imports/csv/rows";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth("imports:run", async (_request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const job = await loadJobFor(auth, id);
  if (!job) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  const rows = Array.isArray(job.badRows) ? (job.badRows as unknown as BadRow[]) : [];
  return new NextResponse(badRowsCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="bad-rows.csv"',
    },
  });
});
