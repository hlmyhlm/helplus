type Args = Record<string, unknown>;

// everything except Company itself belongs to a company
const GLOBAL_MODELS = new Set(["Company"]);

const UNIQUE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);
const FILTER_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);
const CREATE_MANY_OPS = new Set(["createMany", "createManyAndReturn"]);

export function isTenantModel(model: string | undefined): boolean {
  return !!model && !GLOBAL_MODELS.has(model);
}

function withoutCompany(data: unknown): Args {
  if (!data || typeof data !== "object") return {};
  const rest = { ...(data as Args) };
  delete rest.companyId;
  delete rest.company;
  return rest;
}

export function scopeArgs(model: string, operation: string, args: Args | undefined, companyId: string): Args {
  const a: Args = { ...(args ?? {}) };

  if (UNIQUE_OPS.has(operation)) {
    a.where = { ...((a.where as Args) ?? {}), companyId };
    if (operation === "update") a.data = withoutCompany(a.data);
    if (operation === "upsert") {
      a.create = { ...withoutCompany(a.create), companyId };
      a.update = withoutCompany(a.update);
    }
    return a;
  }

  if (FILTER_OPS.has(operation)) {
    a.where = a.where ? { AND: [a.where, { companyId }] } : { companyId };
    if (operation === "updateMany" || operation === "updateManyAndReturn") a.data = withoutCompany(a.data);
    return a;
  }

  if (operation === "create") {
    a.data = { ...withoutCompany(a.data), companyId };
    return a;
  }

  if (CREATE_MANY_OPS.has(operation)) {
    const rows = Array.isArray(a.data) ? a.data : [a.data];
    if (rows.some((r) => !r || typeof r !== "object" || Array.isArray(r))) {
      throw new Error(`tenant scope: ${operation} on ${model} needs object rows in data`);
    }
    a.data = rows.map((r) => ({ ...withoutCompany(r), companyId }));
    return a;
  }

  throw new Error(`tenant scope: unhandled operation ${operation} on ${model}`);
}

const COMPANY_UNIQUE_READS = new Set(["findUnique", "findUniqueOrThrow"]);
const COMPANY_FILTER_READS = new Set(["findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);

// the scoped client only sees its own Company row and can't change it.
// cross-company lookups (slug routing, login, signup) stay on systemPrisma.
export function scopeCompanyArgs(operation: string, args: Args | undefined, companyId: string): Args {
  const a: Args = { ...(args ?? {}) };
  const where = a.where as Args | undefined;

  if (COMPANY_UNIQUE_READS.has(operation)) {
    const and = where?.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
    a.where = { ...(where ?? {}), AND: [...and, { id: companyId }] };
    return a;
  }

  if (COMPANY_FILTER_READS.has(operation)) {
    a.where = where ? { AND: [where, { id: companyId }] } : { id: companyId };
    return a;
  }

  throw new Error(`Company.${operation} isn't allowed on the scoped client, use systemPrisma`);
}

