import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { loadTicketFor } from "@/lib/tickets/load";
import { addAttachment, MAX_BYTES } from "@/lib/attachments/service";
import { isAllowedImage } from "@/lib/privacy/ic-image";
import { toRow } from "@/lib/attachments/row";
import { logger } from "@/lib/logger";

type Ctx = { params: Promise<{ id: string }> };
const MAX_FILES = 5;

export const POST = withAuth("tickets:update", async (request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const ticket = await loadTicketFor(auth, id);
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "Add at least one image" }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `At most ${MAX_FILES} images at a time` }, { status: 400 });

  const buffers: { name: string; data: Buffer }[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) return NextResponse.json({ error: `${f.name} is over 10 MB` }, { status: 413 });
    const data = Buffer.from(await f.arrayBuffer());
    if (!(await isAllowedImage(data))) return NextResponse.json({ error: `${f.name} isn't a PNG, JPEG or WebP image` }, { status: 415 });
    buffers.push({ name: f.name, data });
  }

  try {
    const rows = [];
    for (const b of buffers) rows.push(await addAttachment({ ticketId: id, fileName: b.name, data: b.data }));
    return NextResponse.json({ data: rows.map(toRow) }, { status: 201 });
  } catch (error) {
    logger.error("upload failed", error);
    return NextResponse.json({ error: "Couldn't save the image" }, { status: 500 });
  }
});
