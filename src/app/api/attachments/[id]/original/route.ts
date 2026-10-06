import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { fileStore } from "@/lib/storage";
import { decryptBuffer } from "@/lib/secrets";
import { logActivity } from "@/lib/activity";
import { normalizeImage } from "@/lib/privacy/ic-image";
import { loadAttachmentFor } from "@/lib/attachments/load";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth("attachments:original", async (_request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const a = await loadAttachmentFor(auth, id);
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!a.originalKey) return NextResponse.json({ error: "The original was deleted after the retention period" }, { status: 410 });
  const { png } = await normalizeImage(decryptBuffer(await fileStore().get(a.originalKey)));
  await logActivity("attachment.original_viewed", "attachment", id, `Viewed an original screenshot (${a.fileName})`, auth.name);
  return new NextResponse(new Uint8Array(png), {
    headers: { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
});
