import type { NextRequest } from "next/server";
import { systemPrisma } from "@/lib/prisma";

// providers call us without a login, so the company comes from ?company=<slug>.
// with a single company we allow leaving it off, so existing webhook urls keep working.
export async function resolveWebhookCompany(request: NextRequest): Promise<string | null> {
  const slug = request.nextUrl.searchParams.get("company");
  if (slug) {
    const company = await systemPrisma.company.findUnique({ where: { slug }, select: { id: true } });
    return company?.id ?? null;
  }
  const companies = await systemPrisma.company.findMany({ select: { id: true }, take: 2 });
  return companies.length === 1 ? companies[0].id : null;
}
