import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { currentCompanyId } from "@/lib/tenant/context";
import { loadJobFor } from "@/lib/imports/access";
import { projectProblem } from "@/lib/projects/usable";
import { maskIC } from "@/lib/privacy/ic-mask";
import type { ImportOptions } from "@/lib/imports/run";
import type { CsvField, CsvMapping } from "@/lib/imports/csv/rows";

type Ctx = { params: Promise<{ id: string }> };

const FIELDS: CsvField[] = ["oldId", "question", "answer", "title", "clientName", "clientContact", "createdAt", "closedAt", "category", "priority"];

const mask = (s: string) => maskIC(s).text;
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export const POST = withAuth("imports:run", async (request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    body = {};
  }

  const job = await loadJobFor(auth, id);
  if (!job) return NextResponse.json({ error: "Import not found" }, { status: 404 });
  if (job.status === "failed" || job.status === "uploaded") {
    const problem = await projectProblem(job.projectId);
    if (problem) return NextResponse.json({ error: problem }, { status: problem === "Project not found" ? 404 : 400 });
  }
  // a retry keeps the choices and the progress, the worker carries on where it stopped
  if (job.status === "failed") {
    if (!job.fileKey) return NextResponse.json({ error: "The file is gone, upload it again" }, { status: 409 });
    const { count } = await prisma.importJob.updateMany({
      where: { id: job.id, status: "failed", fileKey: { not: null } },
      data: { status: "queued", error: "", finishedAt: null },
    });
    if (!count) return NextResponse.json({ error: "This import has already started" }, { status: 409 });
    return NextResponse.json({ data: { id: job.id, status: "queued" } });
  }
  if (job.status !== "uploaded") return NextResponse.json({ error: "This import has already started" }, { status: 409 });

  const options = { ...(job.options as ImportOptions) };
  if (body.order !== undefined) {
    if (body.order !== "dmy" && body.order !== "mdy") return bad("Date order must be dmy or mdy");
    options.order = body.order;
  }

  if (job.kind === "whatsapp") {
    const senders = (job.preview as { senders?: { name: string; isStaff?: boolean }[] }).senders ?? [];
    let staff: string[];
    if (body.staff === undefined) staff = senders.filter((s) => s.isStaff).map((s) => s.name);
    else if (Array.isArray(body.staff) && body.staff.every((s) => typeof s === "string")) staff = body.staff as string[];
    else return bad("Staff must be a list of sender names");
    // names are only ever kept masked
    staff = [...new Set(staff.map(mask))];
    options.staff = staff;
    // remember the picks so the next export from this company comes pre-ticked
    for (const name of new Set(senders.map((s) => mask(s.name)))) {
      const isStaff = staff.includes(name);
      await prisma.chatSender.upsert({
        where: { companyId_name: { companyId: currentCompanyId(), name } },
        create: { name, isStaff },
        update: { isStaff },
      });
    }
  } else {
    const headers = (job.preview as { headers?: string[] }).headers ?? [];
    const mapping = (body.mapping ?? options.mapping ?? {}) as CsvMapping;
    if (typeof mapping !== "object" || Array.isArray(mapping)) return bad("Mapping must be an object");
    for (const [field, header] of Object.entries(mapping)) {
      if (!FIELDS.includes(field as CsvField)) return bad(`Unknown field ${field}`);
      if (typeof header !== "string" || !headers.includes(header)) return bad(`There's no column called ${String(header)}`);
    }
    if (!mapping.oldId || !mapping.question) return bad("Pick the columns for the old ID and the question");
    options.mapping = mapping;
  }

  // only one start wins if two clicks race
  const { count } = await prisma.importJob.updateMany({
    where: { id: job.id, status: "uploaded" },
    data: { status: "queued", options: options as never },
  });
  if (!count) return NextResponse.json({ error: "This import has already started" }, { status: 409 });
  return NextResponse.json({ data: { id: job.id, status: "queued" } });
});
