import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { fileStore } from "@/lib/storage";
import { loadAttachmentFor } from "@/lib/attachments/load";

type Ctx = { params: Promise<{ id: string }> };
const IMAGE_HEADERS = { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export const GET = withAuth("tickets:read", async (_request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const a = await loadAttachmentFor(auth, id);
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (a.status === "pending") return NextResponse.json({ status: "pending" }, { status: 202 });
  // no masked copy exists yet, staff must look at the original instead
  if (a.status === "needs_check" || !a.maskedKey) {
    return NextResponse.json({ status: "needs_check", error: "Needs a staff check. Open the original." }, { status: 409 });
  }
  return new NextResponse(new Uint8Array(await fileStore().get(a.maskedKey)), { headers: IMAGE_HEADERS });
});
