import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { allowedProjectIds } from "@/lib/tickets/access";
import { projectProblem } from "@/lib/projects/usable";
import { fileStore, importFileKey } from "@/lib/storage";
import { encryptBuffer } from "@/lib/secrets";
import { maskIC } from "@/lib/privacy/ic-mask";
import { logger } from "@/lib/logger";
import { csvPreview, whatsappPreview, PreviewError } from "@/lib/imports/preview";
import { JOB_FIELDS, jobWhere } from "@/lib/imports/access";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const GET = withAuth("imports:run", async (_request: NextRequest, auth) => {
  const jobs = await prisma.importJob.findMany({
    where: await jobWhere(auth),
    orderBy: { createdAt: "desc" },
    take: 20,
    select: JOB_FIELDS,
  });
  return NextResponse.json({ data: jobs });
});

export const POST = withAuth("imports:run", async (request: NextRequest, auth) => {
  // a chunked request has no length to check, so it can't skip this gate
  const contentLength = Number(request.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(contentLength)) return NextResponse.json({ error: "A Content-Length header is required" }, { status: 411 });
  if (contentLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Files over 50 MB can't be imported. Export without media or in parts." }, { status: 413 });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Couldn't read the upload" }, { status: 400 });
  }
  const file = form.get("file");
  const projectId = String(form.get("projectId") ?? "");
  const kind = String(form.get("kind") ?? "");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a file to import" }, { status: 400 });
  if (kind !== "whatsapp" && kind !== "csv") return NextResponse.json({ error: "Pick WhatsApp or CSV" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "Files over 50 MB can't be imported" }, { status: 413 });

  const allowed = await allowedProjectIds(auth);
  if (!projectId || (allowed !== null && !allowed.includes(projectId))) {
    return NextResponse.json({ error: "You can't import into this project" }, { status: 403 });
  }
  const problem = await projectProblem(projectId);
  if (problem) return NextResponse.json({ error: problem }, { status: problem === "Project not found" ? 404 : 400 });

  const data = Buffer.from(await file.arrayBuffer());
  let preview;
  try {
    preview = kind === "whatsapp" ? await whatsappPreview(data, file.name) : await csvPreview(data);
  } catch (error) {
    if (error instanceof PreviewError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const id = randomUUID();
  const fileKey = importFileKey(auth.companyId, id);
  const options = kind === "whatsapp" ? { order: (preview as { order: string }).order } : { order: "dmy", mapping: (preview as { mapping: unknown }).mapping };
  await fileStore().put(fileKey, encryptBuffer(data));
  try {
    await prisma.importJob.create({
      data: {
        id,
        projectId,
        kind,
        status: "uploaded",
        fileKey,
        fileName: maskIC(file.name).text.slice(0, 200),
        options: options as never,
        preview: preview as never,
        createdById: auth.userId,
      },
    });
  } catch (error) {
    // don't leave an orphaned upload behind
    await fileStore().remove(fileKey).catch(() => {});
    logger.error("couldn't save the import", error);
    return NextResponse.json({ error: "Couldn't save the import" }, { status: 500 });
  }
  return NextResponse.json({ id, kind, preview }, { status: 201 });
});
