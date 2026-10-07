import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { fileStore } from "@/lib/storage";
import { decryptBuffer } from "@/lib/secrets";
import { normalizeImage } from "@/lib/privacy/ic-image";
import { loadAttachmentFor } from "@/lib/attachments/load";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth("attachments:original", async (_request: NextRequest, auth, { params }: Ctx) => {
  if (auth.authMethod === "api_key")
    return NextResponse.json({ error: "Originals can only be opened by a signed-in staff member" }, { status: 403 });
  const { id } = await params;
  const a = await loadAttachmentFor(auth, id);
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!a.originalKey) return NextResponse.json({ error: "The original was deleted after the retention period" }, { status: 410 });

  // write the audit row before any bytes go out, so a failed write serves nothing
  try {
    await prisma.activityLog.create({
      data: {
        action: "attachment.original_viewed",
        entity: "attachment",
        entityId: id,
        description: `Viewed an original screenshot (${a.fileName})`,
        userName: auth.name,
      },
    });
  } catch (error) {
    logger.error("couldn't record an original view", error);
    return NextResponse.json({ error: "Couldn't record this view" }, { status: 500 });
  }

  let png: Buffer;
  try {
    ({ png } = await normalizeImage(decryptBuffer(await fileStore().get(a.originalKey))));
  } catch (error) {
    logger.error("couldn't read an original", error);
    return NextResponse.json({ error: "The original is no longer available" }, { status: 410 });
  }
  return new NextResponse(new Uint8Array(png), {
    headers: { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
});
