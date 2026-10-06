import { prisma } from "@/lib/prisma";
import { currentCompanyId } from "@/lib/tenant/context";

export const DEFAULT_PROJECT_NAME = "General";

export async function defaultProjectId(): Promise<string> {
  const existing = await prisma.project.findFirst({ where: { isDefault: true }, select: { id: true } });
  if (existing) return existing.id;
  const project = await prisma.project.upsert({
    where: { companyId_name: { companyId: currentCompanyId(), name: DEFAULT_PROJECT_NAME } },
    update: { isDefault: true },
    create: { name: DEFAULT_PROJECT_NAME, isDefault: true },
  });
  return project.id;
}
