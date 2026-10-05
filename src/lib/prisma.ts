import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { companyIdOrFallback } from "@/lib/tenant/context";
import { isTenantModel, scopeArgs } from "@/lib/tenant/scope";

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

export const prisma = systemPrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!isTenantModel(model)) return query(args);
        const companyId = companyIdOrFallback();
        return query(scopeArgs(model, operation, args as Record<string, unknown>, companyId) as typeof args);
      },
    },
  },
});
