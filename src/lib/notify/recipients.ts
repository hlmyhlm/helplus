import { prisma } from "@/lib/prisma";
import { canSeeProject } from "@/lib/tickets/access";
import type { EmailKind } from "./templates";

const MANAGERS = ["supervisor", "admin", "owner"];

async function managerEmails(): Promise<string[]> {
  const rows = await prisma.admin.findMany({ where: { role: { in: MANAGERS }, email: { not: "" } }, select: { email: true } });
  return rows.map((r) => r.email);
}

async function emailOf(id: string | null): Promise<string[]> {
  if (!id) return [];
  const a = await prisma.admin.findUnique({ where: { id }, select: { email: true } });
  return a?.email ? [a.email] : [];
}

export async function recipientsFor(
  kind: Exclude<EmailKind, "close_warning">,
  t: { projectId: string; assigneeId: string | null },
  actorId?: string
): Promise<string[]> {
  let list: string[] = [];
  if (kind === "new_ticket") {
    const users = await prisma.admin.findMany({
      where: { notifyNew: true, email: { not: "" } },
      select: { id: true, role: true, email: true },
    });
    for (const u of users) if (await canSeeProject(u, t.projectId)) list.push(u.email);
  } else if (kind === "reopened") {
    list = t.assigneeId && t.assigneeId !== actorId ? await emailOf(t.assigneeId) : [];
  } else if (kind === "sla_warning") {
    list = t.assigneeId ? await emailOf(t.assigneeId) : await managerEmails();
  } else {
    list = [...(await emailOf(t.assigneeId)), ...(await managerEmails())];
  }
  return [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))];
}
