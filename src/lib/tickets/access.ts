import { prisma } from "@/lib/prisma";

const SEE_ALL = new Set(["owner", "admin", "supervisor"]);
const LIMITED = new Set(["staff", "viewer"]);

// null means every project in the company
export async function allowedProjectIds(auth: { role: string; userId: string }): Promise<string[] | null> {
  if (SEE_ALL.has(auth.role)) return null;
  if (!LIMITED.has(auth.role)) return [];
  const rows = await prisma.projectAccess.findMany({ where: { adminId: auth.userId }, select: { projectId: true } });
  return rows.map((r) => r.projectId);
}

export function projectWhere(ids: string[] | null): Record<string, unknown> {
  return ids === null ? {} : { projectId: { in: ids } };
}
