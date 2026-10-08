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

// whether this user is listed on the project, or sees them all
export async function canSeeProject(user: { id: string; role: string }, projectId: string): Promise<boolean> {
  if (SEE_ALL.has(user.role)) return true;
  if (!LIMITED.has(user.role)) return false;
  return !!(await prisma.projectAccess.findFirst({ where: { adminId: user.id, projectId } }));
}

export function projectWhere(ids: string[] | null): Record<string, unknown> {
  return ids === null ? {} : { projectId: { in: ids } };
}

// a conversation shows if any of its tickets is in an allowed project
export function conversationWhere(ids: string[] | null): Record<string, unknown> {
  return ids === null ? {} : { tickets: { some: { projectId: { in: ids } } } };
}

// a person shows if they belong to an allowed project or have a ticket in one
export function customerWhere(ids: string[] | null): Record<string, unknown> {
  if (ids === null) return {};
  return {
    OR: [
      { projectId: { in: ids } },
      { conversations: { some: { tickets: { some: { projectId: { in: ids } } } } } },
    ],
  };
}
