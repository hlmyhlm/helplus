import { prisma } from "@/lib/prisma";

// why a ticket can't go into this project, or null if it can
export async function projectProblem(id: string): Promise<string | null> {
  const project = await prisma.project.findFirst({ where: { id }, select: { archived: true } });
  if (!project) return "Project not found";
  if (project.archived) return "Project is archived";
  return null;
}
