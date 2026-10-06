import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { updateProjectSchema, validateBody } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth("projects:manage", async (request: NextRequest, _auth, { params }: Ctx) => {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const validation = validateBody(updateProjectSchema, await request.json());
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
  if (validation.data.archived && project.isDefault) {
    return NextResponse.json({ error: "The default project can't be archived" }, { status: 400 });
  }
  try {
    return NextResponse.json(await prisma.project.update({ where: { id }, data: validation.data }));
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A project with that name already exists" }, { status: 409 });
    }
    throw error;
  }
});
