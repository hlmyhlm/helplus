import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { currentCompanyId } from "@/lib/tenant/context";
import { isTenantModel, scopeArgs } from "@/lib/tenant/scope";
import { CrossCompanyLinkError, linkedIds } from "@/lib/tenant/links";

const connectionString =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/helplus?schema=public";

const globalForPrisma = globalThis as unknown as {
  systemPrisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// unscoped: login, company lookup, webhooks routing, scripts. keep its use rare.
export const systemPrisma = globalForPrisma.systemPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.systemPrisma = systemPrisma;
}

const WRITE_OPS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert"]);

// a write can set a foreign key to another company's row id. check every linked id
// belongs to the current company before the query runs. uses systemPrisma so the
// check itself isn't re-scoped.
async function assertLinksInCompany(model: string, operation: string, args: Record<string, unknown>, companyId: string) {
  if (!WRITE_OPS.has(operation)) return;
  const payloads = operation === "upsert" ? [args.create, args.update] : [args.data];
  for (const payload of payloads) {
    for (const link of linkedIds(model, payload)) {
      const delegate = link.target.charAt(0).toLowerCase() + link.target.slice(1);
      const count = await (systemPrisma as unknown as Record<string, { count: (a: unknown) => Promise<number> }>)[delegate].count({
        where: { id: link.id, companyId },
      });
      if (count === 0) throw new CrossCompanyLinkError(model, link.field);
    }
  }
}

export const prisma = systemPrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!isTenantModel(model)) return query(args);
        const companyId = currentCompanyId();
        const scoped = scopeArgs(model, operation, args as Record<string, unknown>, companyId);
        await assertLinksInCompany(model, operation, scoped, companyId);
        return query(scoped as typeof args);
      },
    },
  },
});
