import { prisma } from "@/lib/prisma";
import { allowedProjectIds, projectWhere } from "@/lib/tickets/access";

// what the api hands back, never the stored file key
export const JOB_FIELDS = {
  id: true,
  projectId: true,
  kind: true,
  status: true,
  fileName: true,
  options: true,
  stats: true,
  progress: true,
  error: true,
  createdById: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
} as const;

export async function jobWhere(auth: { role: string; userId: string }) {
  return projectWhere(await allowedProjectIds(auth));
}

export async function loadJobFor(auth: { role: string; userId: string }, id: string) {
  return prisma.importJob.findFirst({ where: { id, ...(await jobWhere(auth)) } });
}
