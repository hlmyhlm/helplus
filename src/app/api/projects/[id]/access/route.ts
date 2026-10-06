import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { projectAccessSchema, validateBody } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth("projects:manage", async (_request: NextRequest, _auth, { params }: Ctx) => {
  const { id } = await params;
  if (!(await prisma.project.findUnique({ where: { id } }))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const rows = await prisma.projectAccess.findMany({ where: { projectId: id }, select: { adminId: true } });
  return NextResponse.json({ adminIds: rows.map((r) => r.adminId) });
});

export const PUT = withAuth("projects:manage", async (request: NextRequest, _auth, { params }: Ctx) => {
  const { id } = await params;
  if (!(await prisma.project.findUnique({ where: { id } }))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const validation = validateBody(projectAccessSchema, await request.json());
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });

  // only staff accounts of this company; the scoped client drops anything else
  const users = await prisma.admin.findMany({
    where: { id: { in: validation.data.adminIds }, role: { in: ["staff", "viewer"] } },
    select: { id: true },
  });
  // delete and recreate together, so a failure in between can't leave a project with no access rows
  await prisma.$transaction(async (tx) => {
    await tx.projectAccess.deleteMany({ where: { projectId: id } });
    if (users.length) {
      await tx.projectAccess.createMany({ data: users.map((u) => ({ projectId: id, adminId: u.id })) });
    }
  });
  return NextResponse.json({ adminIds: users.map((u) => u.id) });
});
