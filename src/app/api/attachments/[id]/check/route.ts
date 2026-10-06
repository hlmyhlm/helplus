import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/tenant/with-auth";
import { validateBody } from "@/lib/validations";
import { loadAttachmentFor } from "@/lib/attachments/load";
import { confirmAttachment, remask } from "@/lib/attachments/process";
import { toRow } from "@/lib/attachments/row";

type Ctx = { params: Promise<{ id: string }> };
const box = z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().positive(), h: z.number().positive() });
const checkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("mask"), boxes: z.array(box).min(1).max(50) }),
]);

export const POST = withAuth("attachments:original", async (request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const a = await loadAttachmentFor(auth, id);
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (a.status === "pending") return NextResponse.json({ error: "Still checking this image" }, { status: 409 });
  const validation = validateBody(checkSchema, await request.json().catch(() => ({})));
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
  const actor = { id: auth.userId, name: auth.name };
  try {
    const updated =
      validation.data.action === "confirm" ? await confirmAttachment(id, actor) : await remask(id, validation.data.boxes, actor);
    return NextResponse.json(toRow(updated));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "the original was deleted") return NextResponse.json({ error: "The original was deleted" }, { status: 410 });
    throw error;
  }
});
