# Stage 1B: Companies, Roles, Per-Company Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Help+ multi-company (SaaS-ready): every record belongs to a company, every query is filtered by the current company in one central place, roles become owner/admin/supervisor/staff/viewer/client, and settings are per company.

**Architecture:** A `Company` table, and a `companyId` column on all 27 existing tables. The current company lives in Node's `AsyncLocalStorage` (`src/lib/tenant/context.ts`). The exported `prisma` client is a Prisma query extension that adds `companyId` to every read, write and filter, using a pure function (`src/lib/tenant/scope.ts`). API routes enter the company context through a `withAuth(permission, handler)` wrapper. Code that has no logged-in user (login, webhooks, background listeners, scripts) uses an unscoped `systemPrisma` or enters the context explicitly with `runWithCompany`. When nothing has set a company, queries throw instead of guessing.

**Tech Stack:** Next.js 16, Prisma 7 (`prisma-client` generator + `@prisma/adapter-pg`, query extensions), PostgreSQL 18 (ServBay), Vitest (unit tests with the mocked Prisma, plus a new integration suite against a real test database).

Spec: `docs/specs/2026-10-04-helplus-design.md`, "Structure", "Roles" and "1. Foundation".

## Global Constraints

- Code name `helplus`, display name "Help+". No "owly" anywhere except `LICENSE`.
- Comments only when needed, short and plain, written like a person would. No "This function...", no emoji.
- Commit messages short, lowercase, plain. No Co-Authored-By trailer. Commit locally only. Never push. Never open a PR.
- Before every commit: `npx vitest run` passes and `npx tsc --noEmit` is clean. From Task 2 on, `npm run test:integration` passes too.
- Every company-owned record gets `companyId`. Queries go through one scoped data layer so a page can't forget the filter.
- Isolation: staff and client attempts to read another company's data must fail.
- Writes must use scalar foreign keys (`departmentId: x`), never `connect: {}`. The scope extension adds a scalar `companyId`, and Prisma can't mix the two styles.
- Local database: ServBay Postgres, db `helpplus` (dev) and `helpplus_test` (integration tests), user `helpplus`, password `helpplus_dev_2026`. psql: `/c/ServBay/packages/postgresql/18/bin/psql.exe`.
- The default company that existing data moves into has id `default`, slug `default`, name `My Company`.

---

## File map

| File | Status | Job |
|---|---|---|
| `src/lib/tenant/context.ts` | new | current company in AsyncLocalStorage |
| `src/lib/tenant/scope.ts` | new | pure function: add `companyId` to Prisma args |
| `src/lib/tenant/keys.ts` | new | compound unique keys (`Channel` type, `Tag` name) |
| `src/lib/tenant/with-auth.ts` | new | route wrapper: auth + permission + company context |
| `src/lib/tenant/webhook-company.ts` | new | pick the company for public webhooks |
| `src/lib/prisma.ts` | modify | `systemPrisma` (raw) + `prisma` (scoped) |
| `prisma/schema.prisma` | modify | `Company` model, `companyId` everywhere |
| `prisma/migrations/20261005000000_companies/migration.sql` | new | create Company, backfill, constraints |
| `prisma/migrations/20261005010000_roles/migration.sql` | new | agent/editor → staff, first admin → owner |
| `vitest.integration.config.ts`, `tests/integration/*` | new | real-database isolation tests |
| `src/lib/rbac.ts` | modify | new role list |
| `src/lib/route-auth.ts`, `src/lib/auth.ts`, `src/app/api/auth/route.ts` | modify | company on the auth context, system client |
| all `src/app/api/**/route.ts` | modify | `withAuth` |
| `src/lib/realtime.ts` | modify | events keyed by company |
| channels, dashboard page, scripts, instrumentation | modify | enter the company context |
| `src/lib/settings.ts`, `src/lib/twilio-verify.ts` | modify | per-company settings, unsigned webhooks off by default |

---

### Task 1: Company context and scope rules (no database change yet)

**Files:**
- Create: `src/lib/tenant/context.ts`, `src/lib/tenant/scope.ts`, `src/lib/tenant/keys.ts`
- Test: `tests/unit/tenant-context.test.ts`, `tests/unit/tenant-scope.test.ts`

**Interfaces:**
- Produces:
  - `runWithCompany<T>(companyId: string, fn: () => T): T`
  - `currentCompanyId(): string` (throws `MissingCompanyError`)
  - `maybeCompanyId(): string | undefined`
  - `class MissingCompanyError extends Error`
  - `isTenantModel(model: string | undefined): boolean`
  - `scopeArgs(model: string, operation: string, args: Record<string, unknown> | undefined, companyId: string): Record<string, unknown>`
  - `channelKey(type: string)`, `tagKey(name: string)` (used from Task 2)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/tenant-context.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runWithCompany, currentCompanyId, maybeCompanyId, MissingCompanyError } from "@/lib/tenant/context";

describe("company context", () => {
  it("is empty outside runWithCompany", () => {
    expect(maybeCompanyId()).toBeUndefined();
    expect(() => currentCompanyId()).toThrow(MissingCompanyError);
  });

  it("holds the company inside runWithCompany, across awaits", async () => {
    const seen = await runWithCompany("co-1", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentCompanyId();
    });
    expect(seen).toBe("co-1");
  });

  it("keeps concurrent companies apart", async () => {
    const run = (id: string) =>
      runWithCompany(id, async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        return currentCompanyId();
      });
    expect(await Promise.all([run("a"), run("b"), run("c")])).toEqual(["a", "b", "c"]);
  });

  it("refuses an empty company id", () => {
    expect(() => runWithCompany("", () => 1)).toThrow(MissingCompanyError);
  });
});
```

Create `tests/unit/tenant-scope.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scopeArgs, isTenantModel } from "@/lib/tenant/scope";
import { channelKey, tagKey } from "@/lib/tenant/keys";
import { runWithCompany } from "@/lib/tenant/context";

const C = "co-1";

describe("isTenantModel", () => {
  it("treats Company as global and everything else as tenant data", () => {
    expect(isTenantModel("Company")).toBe(false);
    expect(isTenantModel("Ticket")).toBe(true);
    expect(isTenantModel(undefined)).toBe(false);
  });
});

describe("scopeArgs", () => {
  it("adds companyId to unique lookups", () => {
    expect(scopeArgs("Ticket", "findUnique", { where: { id: "t1" } }, C)).toEqual({
      where: { id: "t1", companyId: C },
    });
  });

  it("wraps filters in AND so OR conditions can't escape", () => {
    const out = scopeArgs("Ticket", "findMany", { where: { OR: [{ status: "open" }, { status: "new" }] } }, C);
    expect(out.where).toEqual({ AND: [{ OR: [{ status: "open" }, { status: "new" }] }, { companyId: C }] });
  });

  it("adds a filter when there was none", () => {
    expect(scopeArgs("Ticket", "count", undefined, C)).toEqual({ where: { companyId: C } });
  });

  it("stamps companyId on create and ignores one passed in", () => {
    const out = scopeArgs("Ticket", "create", { data: { title: "x", companyId: "other" } }, C);
    expect(out.data).toEqual({ title: "x", companyId: C });
  });

  it("stamps every row of createMany", () => {
    const out = scopeArgs("Tag", "createMany", { data: [{ name: "a" }, { name: "b", companyId: "x" }] }, C);
    expect(out.data).toEqual([
      { name: "a", companyId: C },
      { name: "b", companyId: C },
    ]);
  });

  it("never lets an update move a row to another company", () => {
    expect(scopeArgs("Ticket", "update", { where: { id: "t1" }, data: { companyId: "other", title: "y" } }, C)).toEqual({
      where: { id: "t1", companyId: C },
      data: { title: "y" },
    });
    expect(scopeArgs("Ticket", "updateMany", { where: {}, data: { companyId: "other" } }, C).data).toEqual({});
  });

  it("scopes upsert lookup, create and update", () => {
    expect(
      scopeArgs("Channel", "upsert", { where: { id: "c1" }, create: { type: "email" }, update: { companyId: "x", status: "ok" } }, C)
    ).toEqual({
      where: { id: "c1", companyId: C },
      create: { type: "email", companyId: C },
      update: { status: "ok" },
    });
  });

  it("scopes deleteMany, aggregate and groupBy", () => {
    for (const op of ["deleteMany", "aggregate", "groupBy", "findFirst"]) {
      expect(scopeArgs("Ticket", op, { where: { status: "open" } }, C).where).toEqual({
        AND: [{ status: "open" }, { companyId: C }],
      });
    }
  });

  it("refuses operations it doesn't know", () => {
    expect(() => scopeArgs("Ticket", "somethingNew", {}, C)).toThrow(/unhandled operation/);
  });
});

describe("compound keys", () => {
  it("builds per-company unique keys", () => {
    runWithCompany(C, () => {
      expect(channelKey("whatsapp")).toEqual({ companyId_type: { companyId: C, type: "whatsapp" } });
      expect(tagKey("vip")).toEqual({ companyId_name: { companyId: C, name: "vip" } });
    });
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/tenant-context.test.ts tests/unit/tenant-scope.test.ts`
Expected: FAIL, cannot resolve `@/lib/tenant/context`.

- [ ] **Step 3: Write the context**

Create `src/lib/tenant/context.ts`:

```ts
import { AsyncLocalStorage } from "node:async_hooks";

interface TenantStore {
  companyId: string;
}

const storage = new AsyncLocalStorage<TenantStore>();

export class MissingCompanyError extends Error {
  constructor() {
    super("no company in context, wrap the call in runWithCompany()");
    this.name = "MissingCompanyError";
  }
}

export function runWithCompany<T>(companyId: string, fn: () => T): T {
  if (!companyId) throw new MissingCompanyError();
  return storage.run({ companyId }, fn);
}

export function currentCompanyId(): string {
  const id = storage.getStore()?.companyId;
  if (!id) throw new MissingCompanyError();
  return id;
}

export function maybeCompanyId(): string | undefined {
  return storage.getStore()?.companyId;
}
```

- [ ] **Step 4: Write the scope rules and keys**

Create `src/lib/tenant/scope.ts`:

```ts
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
    a.data = rows.map((r) => ({ ...withoutCompany(r), companyId }));
    return a;
  }

  throw new Error(`tenant scope: unhandled operation ${operation} on ${model}`);
}
```

Create `src/lib/tenant/keys.ts`:

```ts
import { currentCompanyId } from "./context";

// Channel.type and Tag.name are unique per company, not globally
export function channelKey(type: string) {
  return { companyId_type: { companyId: currentCompanyId(), type } };
}

export function tagKey(name: string) {
  return { companyId_name: { companyId: currentCompanyId(), name } };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/tenant-context.test.ts tests/unit/tenant-scope.test.ts`
Expected: PASS (4 + 11 tests).

Run: `npx tsc --noEmit` — Expected: no output.
Run: `npx vitest run` — Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tenant tests/unit/tenant-context.test.ts tests/unit/tenant-scope.test.ts
git commit -m "add company context and query scope rules"
```

---

### Task 2: Companies in the database, scoped Prisma client, integration tests

After this task every table has `companyId`, and the exported `prisma` client scopes every query. Code that hasn't been given a company yet falls back to `default`. That fallback is temporary and is removed in Task 5.

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/prisma.ts`, `prisma/seed.ts`, `tests/setup.ts`, `vitest.config.ts`, `package.json`, `.env.example`, and every file `tsc` flags for Channel/Tag unique keys (listed in Step 6)
- Create: `prisma/migrations/20261005000000_companies/migration.sql`, `vitest.integration.config.ts`, `tests/integration/setup.ts`, `tests/integration/tenant-isolation.test.ts`

**Interfaces:**
- Consumes: `scopeArgs`, `isTenantModel`, `maybeCompanyId`, `runWithCompany`, `channelKey`, `tagKey` (Task 1)
- Produces: `systemPrisma` (unscoped `PrismaClient`) and `prisma` (scoped) from `@/lib/prisma`. A `Company` model `{ id, name, slug @unique, createdAt, updatedAt }`. `companyId String` on all 27 models. `Settings.companyId` is `@unique`, and `Settings.id` now defaults to `uuid()`. `npm run test:integration`.

- [ ] **Step 1: Schema**

In `prisma/schema.prisma`:

(a) Add this model at the top, under the `datasource` block:

```prisma
model Company {
  id        String   @id @default(uuid())
  name      String
  slug      String   @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  settings          Settings?
  admins            Admin[]
  categories        Category[]
  knowledgeEntries  KnowledgeEntry[]
  departments       Department[]
  teamMembers       TeamMember[]
  conversations     Conversation[]
  messages          Message[]
  tickets           Ticket[]
  tags              Tag[]
  conversationTags  ConversationTag[]
  callLogs          CallLog[]
  channels          Channel[]
  schedules         Schedule[]
  webhooks          Webhook[]
  webhookDeliveries WebhookDelivery[]
  activityLogs      ActivityLog[]
  slaRules          SLARule[]
  cannedResponses   CannedResponse[]
  customers         Customer[]
  customerNotes     CustomerNote[]
  automationRules   AutomationRule[]
  businessHours     BusinessHours[]
  apiKeys           ApiKey[]
  internalNotes     InternalNote[]
  campaigns         Campaign[]
  flows             Flow[]
}
```

(b) In **every** other model (all 27), add these two lines as the first fields after `id`:

```prisma
  // set by the tenant scope extension, never by hand
  companyId String  @default("")
  company   Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
```

(Only the very first model needs the comment.) Also add `@@index([companyId])` to every model except `Settings`.

(c) `Settings` is one row per company:
- Change `id String @id @default("default")` to `id String @id @default(uuid())`.
- Make its companyId line `companyId String @unique @default("")`.
- Make its relation `company Company @relation(fields: [companyId], references: [id], onDelete: Cascade)`.

(d) Per-company uniques:
- In `Channel`, change `type String @unique` to `type String` and add `@@unique([companyId, type])`.
- In `Tag`, change `name String @unique` to `name String` and add `@@unique([companyId, name])`.
- `Admin.username`, `ApiKey.key` and `CallLog.callSid` stay globally unique: logins, API keys and Twilio call ids must be unique across all companies.

Run: `npx prisma validate` — Expected: `The schema at prisma\schema.prisma is valid`.

- [ ] **Step 2: Migration**

Create `prisma/migrations/20261005000000_companies/migration.sql`:

```sql
-- companies, and move every existing row into the default company
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");
INSERT INTO "Company" ("id", "name", "slug", "updatedAt") VALUES ('default', 'My Company', 'default', CURRENT_TIMESTAMP);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Settings','Admin','Category','KnowledgeEntry','Department','TeamMember','Conversation','Message',
    'Ticket','Tag','ConversationTag','CallLog','Channel','Schedule','Webhook','WebhookDelivery',
    'ActivityLog','SLARule','CannedResponse','Customer','CustomerNote','AutomationRule','BusinessHours',
    'ApiKey','InternalNote','Campaign','Flow'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "companyId" TEXT NOT NULL DEFAULT %L', t, 'default');
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "companyId" SET DEFAULT %L', t, '');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE',
      t, t || '_companyId_fkey');
    IF t <> 'Settings' THEN
      EXECUTE format('CREATE INDEX %I ON %I ("companyId")', t || '_companyId_idx', t);
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX "Settings_companyId_key" ON "Settings"("companyId");

DROP INDEX "Tag_name_key";
CREATE UNIQUE INDEX "Tag_companyId_name_key" ON "Tag"("companyId", "name");

DROP INDEX "Channel_type_key";
CREATE UNIQUE INDEX "Channel_companyId_type_key" ON "Channel"("companyId", "type");
```

Apply it to the **dev** database. Don't use `db push` here: it would add the column with `''` and break the foreign key on existing rows.

Run: `PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/psql.exe -h localhost -U helpplus -d helpplus -v ON_ERROR_STOP=1 -f prisma/migrations/20261005000000_companies/migration.sql`
Expected: ends with `CREATE INDEX` and no `ERROR`.

Then check the schema and database agree, and regenerate the client:

Run: `npx prisma db push && npx prisma generate`
Expected: `The database is already in sync with the Prisma schema.` (or only harmless index renames) and `Generated Prisma Client`. If `db push` wants to drop data, stop and report.

Apply the schema to the empty **test** database:

Run: `DATABASE_URL="postgresql://helpplus:helpplus_dev_2026@localhost:5432/helpplus_test?schema=public" npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema.`

- [ ] **Step 3: Scoped client**

Replace all of `src/lib/prisma.ts` with:

```ts
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { maybeCompanyId } from "@/lib/tenant/context";
import { isTenantModel, scopeArgs } from "@/lib/tenant/scope";

const connectionString =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/helplus?schema=public";

// TEMPORARY: lets code that doesn't set a company yet keep working. removed once every entry point does.
const FALLBACK_COMPANY_ID = "default";

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
        const companyId = maybeCompanyId() ?? FALLBACK_COMPANY_ID;
        return query(scopeArgs(model, operation, args as Record<string, unknown>, companyId) as typeof args);
      },
    },
  },
});
```

- [ ] **Step 4: Unit test mock exports both clients**

`tests/setup.ts`:
- In the `vi.mock("@/lib/prisma", ...)` factory, return `{ prisma: client, systemPrisma: client }`, where `client` is one `createMockPrismaClient()` call, so both names share the same mocks.
- Add `"company"` to the `models` array in `createMockPrismaClient`.

```ts
vi.mock("@/lib/prisma", () => {
  const client = createMockPrismaClient();
  return { prisma: client, systemPrisma: client };
});
```

- [ ] **Step 5: Seed into the default company**

`prisma/seed.ts`:
- Remove its own `PrismaClient` / `PrismaPg` setup and `connectionString`.
- Keep the `.env` loading at the top.
- Import `import { prisma, systemPrisma } from "../src/lib/prisma";` and `import { runWithCompany } from "../src/lib/tenant/context";`.
- At the start of `main()`, before anything else:

```ts
  await systemPrisma.company.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", name: "My Company", slug: "default" },
  });
```

- Wrap the rest of `main()`'s body in `await runWithCompany("default", async () => { ... });`.
- Replace any `prisma.$disconnect()` with `systemPrisma.$disconnect()`.
- Channel and Tag upserts in the seed use `where: channelKey(type)` / `where: tagKey(name)` (import from `../src/lib/tenant/keys`).
- Settings in the seed: use `where: { companyId: "default" }` and drop any `id: "default"`.

Run: `npm run db:seed` — Expected: `Seed data created successfully!`

- [ ] **Step 6: Fix the call sites the schema change breaks**

Run: `npx tsc --noEmit`
Expected: errors at the Channel/Tag/Settings unique lookups. Fix each one:

- `prisma.channel.*({ where: { type } ... })` → `where: channelKey(type)`, importing `channelKey` from `@/lib/tenant/keys`. Known sites: `src/app/api/auth/route.ts`, `src/app/api/channels/route.ts`, `src/app/api/channels/[type]/route.ts` (four places), `src/lib/channels/whatsapp.ts` (two).
- `prisma.tag.findUnique({ where: { name } })` in `src/lib/conversation-engine.ts` → `where: tagKey(name)`.
- `src/lib/settings.ts`:
  - Replace `where: { id: "default" }` with `where: { companyId: currentCompanyId() }` (import from `@/lib/tenant/context`).
  - Replace `create: { id: "default" }` with `create: {}`.
  - Replace `create: { id: "default", ...(data as Prisma.SettingsCreateInput) }` with `create: { ...(data as Prisma.SettingsCreateInput) }`.
- `src/app/api/customers/route.ts`: the nested `notes: { create: { content, authorName } }` must also set `companyId: currentCompanyId()`, because nested writes don't go through the extension.

Unit tests that assert `where: { id: "default" }` for settings: update them to `where: { companyId: ... }` and wrap the call in `runWithCompany("test-company", ...)`, or mock accordingly. Make the smallest change that keeps their intent.

Re-run: `npx tsc --noEmit` — Expected: no output.
Run: `npx vitest run` — Expected: all pass.

- [ ] **Step 7: Integration test setup**

Add to `.env.example` (under the database section):

```
# Separate database for npm run test:integration. It gets wiped by the tests.
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/helplus_test?schema=public"
```

Add to your local `.env` (not committed):
`TEST_DATABASE_URL="postgresql://helpplus:helpplus_dev_2026@localhost:5432/helpplus_test?schema=public"`

`vitest.config.ts`: add `exclude: ["tests/integration/**", "node_modules/**"],` inside `test`.

Create `vitest.integration.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
```

Create `tests/integration/setup.ts`:

```ts
// runs before any test file imports prisma, so the client connects to the test database
try {
  (process as { loadEnvFile?: () => void }).loadEnvFile?.();
} catch {
  // no .env, rely on the environment
}

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is not set. Point it at an empty database, the tests wipe it.");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.HELPLUS_SECRET_KEY ||= "b2".repeat(32);
```

`package.json` scripts, after `"test:coverage"`:

```json
    "test:integration": "vitest run --config vitest.integration.config.ts",
```

- [ ] **Step 8: Write the isolation tests**

Create `tests/integration/tenant-isolation.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { channelKey } from "@/lib/tenant/keys";

const A = "it-company-a";
const B = "it-company-b";

const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);
const asB = <T>(fn: () => Promise<T>) => runWithCompany(B, fn);

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({
    data: [
      { id: A, name: "Company A", slug: A },
      { id: B, name: "Company B", slug: B },
    ],
  });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("tenant isolation", () => {
  it("stamps new rows with the current company", async () => {
    const c = await asA(() => prisma.customer.create({ data: { name: "Ali" } }));
    expect(c.companyId).toBe(A);
  });

  it("does not list another company's rows", async () => {
    await asA(() => prisma.customer.create({ data: { name: "only-in-a" } }));
    const seen = await asB(() => prisma.customer.findMany({ where: { name: "only-in-a" } }));
    expect(seen).toEqual([]);
  });

  it("does not find another company's row by id", async () => {
    const c = await asA(() => prisma.customer.create({ data: { name: "by-id" } }));
    expect(await asB(() => prisma.customer.findUnique({ where: { id: c.id } }))).toBeNull();
  });

  it("cannot update or delete another company's row", async () => {
    const c = await asA(() => prisma.customer.create({ data: { name: "locked" } }));
    await expect(asB(() => prisma.customer.update({ where: { id: c.id }, data: { name: "hacked" } }))).rejects.toThrow();
    await expect(asB(() => prisma.customer.delete({ where: { id: c.id } }))).rejects.toThrow();
    const still = await asA(() => prisma.customer.findUnique({ where: { id: c.id } }));
    expect(still?.name).toBe("locked");
  });

  it("bulk writes don't cross companies", async () => {
    await asA(() => prisma.customer.create({ data: { name: "bulk" } }));
    const updated = await asB(() => prisma.customer.updateMany({ where: { name: "bulk" }, data: { name: "x" } }));
    const deleted = await asB(() => prisma.customer.deleteMany({ where: { name: "bulk" } }));
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);
  });

  it("an OR filter can't reach another company", async () => {
    await asA(() => prisma.customer.create({ data: { name: "or-test" } }));
    const seen = await asB(() =>
      prisma.customer.findMany({ where: { OR: [{ name: "or-test" }, { email: "nobody" }] } })
    );
    expect(seen).toEqual([]);
  });

  it("can't move a row into another company", async () => {
    const c = await asA(() => prisma.customer.create({ data: { name: "mover" } }));
    await asA(() => prisma.customer.update({ where: { id: c.id }, data: { companyId: B } as never }));
    const raw = await systemPrisma.customer.findUnique({ where: { id: c.id } });
    expect(raw?.companyId).toBe(A);
  });

  it("counts only the current company", async () => {
    const before = await asB(() => prisma.customer.count());
    await asA(() => prisma.customer.create({ data: { name: "count-me" } }));
    expect(await asB(() => prisma.customer.count())).toBe(before);
  });

  it("allows the same channel type in two companies", async () => {
    const a = await asA(() => prisma.channel.upsert({ where: channelKey("whatsapp"), update: {}, create: { type: "whatsapp" } }));
    const b = await asB(() => prisma.channel.upsert({ where: channelKey("whatsapp"), update: {}, create: { type: "whatsapp" } }));
    expect(a.id).not.toBe(b.id);
    expect([a.companyId, b.companyId]).toEqual([A, B]);
  });

  it("deleting a company removes its data", async () => {
    await systemPrisma.company.create({ data: { id: "it-temp", name: "Temp", slug: "it-temp" } });
    await runWithCompany("it-temp", () => prisma.customer.create({ data: { name: "temp-row" } }));
    await systemPrisma.company.delete({ where: { id: "it-temp" } });
    expect(await systemPrisma.customer.count({ where: { companyId: "it-temp" } })).toBe(0);
  });
});
```

- [ ] **Step 9: Run everything**

Run: `npm run test:integration` — Expected: 10 passing.
Run: `npx vitest run` — Expected: all pass, and the integration files are not picked up.
Run: `npx tsc --noEmit` — Expected: no output.
Run: `npm run smoke` (dev server on :3000; restart it first, because the Prisma client was regenerated) — Expected: `no runtime errors`.

- [ ] **Step 10: Commit**

```bash
git add prisma src tests vitest.config.ts vitest.integration.config.ts package.json .env.example
git commit -m "add companies and scope every query by company"
```

---

### Task 3: Company on the login, roles cleanup, withAuth

**Files:**
- Create: `src/lib/tenant/with-auth.ts`, `tests/unit/with-auth.test.ts`, `prisma/migrations/20261005010000_roles/migration.sql`
- Modify: `src/lib/rbac.ts`, `tests/unit/rbac.test.ts`, `src/lib/route-auth.ts`, `src/lib/auth.ts`, `src/app/api/auth/route.ts`, `src/lib/validations.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/admin/users/[id]/route.ts`, `src/app/(dashboard)/admin/page.tsx`, `tests/setup.ts`

**Interfaces:**
- Consumes: `systemPrisma`, `prisma` (Task 2), `runWithCompany` (Task 1)
- Produces:
  - `AuthContext` gains `companyId: string`, exported from `src/lib/route-auth.ts`
  - `withAuth<C>(permission: Permission | undefined, handler: (request: NextRequest, auth: AuthContext, ctx: C) => Promise<Response>): (request: NextRequest, ctx: C) => Promise<Response>`
  - `ROLES = ["client","viewer","staff","supervisor","admin","owner"]`
  - `STAFF_ROLES = ["viewer","staff","supervisor","admin","owner"]`
  - a new permission `"company:manage"` (owner only)
  - `getCurrentUser()` returns `{ id, username, name, role, companyId } | null`

Role meaning:

| Role | Who |
|---|---|
| owner | The company's top admin. Can do everything an admin can, plus `company:manage`. |
| admin | Everything in the company |
| supervisor | Team lead (unchanged) |
| staff | Support staff. Was `agent`; the old `editor` value never matched any permission. |
| viewer | Read only |
| client | Help-centre users (stage 5). No dashboard permissions at all. |

- [ ] **Step 1: Roles test first**

In `tests/unit/rbac.test.ts`:
- Replace every `"agent"` with `"staff"`, and change test names to match.
- Add:

```ts
  it("owner can do everything admin can, plus company:manage", () => {
    for (const p of getPermissionsForRole("admin")) expect(hasPermission("owner", p)).toBe(true);
    expect(hasPermission("owner", "company:manage")).toBe(true);
    expect(hasPermission("admin", "company:manage")).toBe(false);
  });

  it("client has no dashboard permissions", () => {
    expect(getPermissionsForRole("client")).toEqual([]);
  });

  it("orders roles from client up to owner", () => {
    expect(hasMinRole("owner", "admin")).toBe(true);
    expect(hasMinRole("client", "viewer")).toBe(false);
  });
```

Run: `npx vitest run tests/unit/rbac.test.ts` — Expected: FAIL (no `staff`/`owner` yet).

- [ ] **Step 2: Roles**

`src/lib/rbac.ts`:
- Replace the header comment with `// roles, lowest to highest. each permission lists who may use it.`
- Set:

```ts
export const ROLES = ["client", "viewer", "staff", "supervisor", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

// roles that can log in to the dashboard
export const STAFF_ROLES = ["viewer", "staff", "supervisor", "admin", "owner"] as const;
```

- In `PERMISSIONS`, replace every `"agent"` with `"staff"`, and add `"owner"` to every list that contains `"admin"`. Run: `sed -i 's/"agent"/"staff"/g; s/"admin"\]/"admin", "owner"]/g' src/lib/rbac.ts`, then check by eye that every list ends with `"admin", "owner"]`.
- Add at the end of `PERMISSIONS`:

```ts
  // Company (owner only)
  "company:manage": ["owner"],
```

Run: `npx vitest run tests/unit/rbac.test.ts` — Expected: PASS.

- [ ] **Step 3: Role migration**

Create `prisma/migrations/20261005010000_roles/migration.sql`:

```sql
-- agent was renamed staff; editor never matched a permission, treat it as staff too
UPDATE "Admin" SET "role" = 'staff' WHERE "role" IN ('agent', 'editor');

-- the earliest admin of each company becomes its owner
UPDATE "Admin" SET "role" = 'owner'
WHERE "id" IN (
  SELECT DISTINCT ON ("companyId") "id" FROM "Admin"
  WHERE "role" = 'admin'
  ORDER BY "companyId", "createdAt"
);
```

Run: `PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/psql.exe -h localhost -U helpplus -d helpplus -v ON_ERROR_STOP=1 -f prisma/migrations/20261005010000_roles/migration.sql`
Expected: two `UPDATE n` lines.

Check: `PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/psql.exe -h localhost -U helpplus -d helpplus -tAc 'select username, role from "Admin"'`
Expected: `admin|owner`.

- [ ] **Step 4: Company on the auth context**

`src/lib/route-auth.ts`:
- `import { systemPrisma } from "@/lib/prisma";` instead of `prisma`. Logins and API keys are looked up before we know the company.
- `export interface AuthContext` (add `export`), and add `companyId: string;`.
- `authenticateApiKey`: use `systemPrisma.apiKey` for both calls, and return `companyId: key.companyId`.
- Cookie path: use `systemPrisma.admin.findUnique({ where: { id: payload.userId }, select: { id: true, username: true, name: true, role: true, companyId: true } })`, and return `companyId: admin.companyId`.
- After loading the admin, check permissions against the **database** role, not the token's. If the role changed since login, the token is stale:

```ts
  if (permission && !hasPermission(admin.role, permission)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
      { status: 403 }
    );
  }
```

Move the existing token-role check below the admin lookup and switch it to `admin.role`.

`src/lib/auth.ts`:
- `getCurrentUser` and `isSetupComplete` use `systemPrisma`.
- `getCurrentUser` selects `companyId: true` too.

`tests/setup.ts`: the mocked `requireAuth` resolves to the same object plus `companyId: "test-company"`.

- [ ] **Step 5: withAuth, test first**

Create `tests/unit/with-auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/route-auth";
import { currentCompanyId } from "@/lib/tenant/context";
import { withAuth } from "@/lib/tenant/with-auth";

const mockedRequireAuth = vi.mocked(requireAuth);

beforeEach(() => {
  mockedRequireAuth.mockReset();
});

const auth = (over: Record<string, unknown> = {}) => ({
  userId: "u1",
  role: "admin",
  username: "admin",
  name: "Admin",
  authMethod: "cookie" as const,
  companyId: "co-9",
  ...over,
});

describe("withAuth", () => {
  it("runs the handler inside the user's company", async () => {
    mockedRequireAuth.mockResolvedValue(auth());
    const handler = withAuth("tickets:read", async () => NextResponse.json({ company: currentCompanyId() }));
    const res = await handler({} as never, {} as never);
    expect(await res.json()).toEqual({ company: "co-9" });
    expect(mockedRequireAuth).toHaveBeenCalledWith({}, "tickets:read");
  });

  it("returns the auth error without calling the handler", async () => {
    const denied = NextResponse.json({ error: "no" }, { status: 401 });
    mockedRequireAuth.mockResolvedValue(denied);
    const inner = vi.fn();
    const res = await withAuth("tickets:read", inner)({} as never, {} as never);
    expect(res.status).toBe(401);
    expect(inner).not.toHaveBeenCalled();
  });

  it("keeps client users out of routes that don't name a permission", async () => {
    mockedRequireAuth.mockResolvedValue(auth({ role: "client" }));
    const inner = vi.fn();
    const res = await withAuth(undefined, inner)({} as never, {} as never);
    expect(res.status).toBe(403);
    expect(inner).not.toHaveBeenCalled();
  });

  it("passes the route context through", async () => {
    mockedRequireAuth.mockResolvedValue(auth());
    const ctx = { params: Promise.resolve({ id: "42" }) };
    const handler = withAuth("tickets:read", async (_req, _auth, c: typeof ctx) =>
      NextResponse.json(await c.params)
    );
    expect(await (await handler({} as never, ctx)).json()).toEqual({ id: "42" });
  });
});
```

`tests/setup.ts` mocks `requireAuth` and `isAuthenticated` globally; the real `isAuthenticated` is `!(result instanceof NextResponse)`. For this test, make the global mock's `isAuthenticated` implementation that real check: `isAuthenticated: vi.fn((r) => !(r instanceof NextResponse))`, importing `NextResponse` inside the mock factory with `await import("next/server")`. This keeps every existing test working, since they all resolve a non-Response context.

Run: `npx vitest run tests/unit/with-auth.test.ts` — Expected: FAIL, cannot resolve `@/lib/tenant/with-auth`.

Create `src/lib/tenant/with-auth.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthenticated, type AuthContext } from "@/lib/route-auth";
import type { Permission } from "@/lib/rbac";
import { runWithCompany } from "./context";

// every logged-in api route goes through this, so queries are always scoped to the user's company
export function withAuth<C>(
  permission: Permission | undefined,
  handler: (request: NextRequest, auth: AuthContext, ctx: C) => Promise<Response>
) {
  return async (request: NextRequest, ctx: C): Promise<Response> => {
    const auth = await requireAuth(request, permission);
    if (!isAuthenticated(auth)) return auth;
    if (!permission && auth.role === "client") {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Insufficient permissions" } }, { status: 403 });
    }
    return runWithCompany(auth.companyId, () => handler(request, auth, ctx));
  };
}
```

Run: `npx vitest run tests/unit/with-auth.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 6: Login and first-run setup**

`src/app/api/auth/route.ts`:
- Import `systemPrisma` (in addition to `prisma`), plus `runWithCompany` from `@/lib/tenant/context` and `channelKey` from `@/lib/tenant/keys`.
- Every `prisma.admin` in this file becomes `systemPrisma.admin`.
- In the `setup` branch, replace everything from `const hashed = await hashPassword(password);` up to and including the channel loop with:

```ts
    const hashed = await hashPassword(password);

    // first run: use the default company (it already holds any migrated data), or create it
    const company = await systemPrisma.company.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default", name: "My Company", slug: "default" },
    });

    const admin = await systemPrisma.admin.create({
      data: {
        username,
        password: hashed,
        name: name || "Admin",
        role: "owner",
        companyId: company.id,
      },
    });

    await runWithCompany(company.id, async () => {
      await saveSettings({});
      for (const type of ["whatsapp", "email", "phone"]) {
        await prisma.channel.upsert({
          where: channelKey(type),
          update: {},
          create: { type, isActive: false, status: "disconnected" },
        });
      }
    });
```

- Any other branch in this file that reads company data with `prisma` must run inside `runWithCompany(admin.companyId, ...)` or through `getCurrentUser()`'s `companyId`. Check each branch, and leave a short comment wherever you wrap.

- [ ] **Step 7: One role list everywhere**

- `src/lib/validations.ts` `createAdminSchema`: `role: z.enum(["viewer", "staff", "supervisor", "admin", "owner"]).default("staff"),`
- `src/app/api/admin/users/route.ts`:
  - Replace `const validRoles = ["admin", "editor", "viewer"];` and the line after it with:

    ```ts
    const userRole = (STAFF_ROLES as readonly string[]).includes(role) ? role : "staff";
    if (userRole === "owner" && auth.role !== "owner") {
      return NextResponse.json({ error: "Only an owner can add another owner" }, { status: 403 });
    }
    ```

  - Import `STAFF_ROLES` from `@/lib/rbac`.
  - If the handler doesn't have `auth` in scope yet, it will after Task 4. For now, read it from the existing `requireAuth` call in the same handler.
- `src/app/api/admin/users/[id]/route.ts`:
  - Same `STAFF_ROLES` check and owner-only rule for role changes.
  - The "prevent removing the last admin" logic becomes "prevent removing the last owner". Count `where: { role: "owner" }`, and block changing or deleting the last owner (keep the existing error style).
- `src/app/(dashboard)/admin/page.tsx`:
  - Role `<select>` options:

    ```tsx
    <option value="owner">Owner - Everything, incl. company settings</option>
    <option value="admin">Admin - Full access</option>
    <option value="supervisor">Supervisor - Team lead</option>
    <option value="staff">Staff - Handles tickets</option>
    <option value="viewer">Viewer - Read only</option>
    ```

  - Default form role `"staff"` in both places.
  - `roleBadgeStyles`: keys `owner`, `admin`, `supervisor`, `staff`, `viewer`. Reuse the existing admin style for owner and admin, the existing editor style for supervisor and staff, and the viewer style for viewer.
  - Fallback `roleBadgeStyles.viewer`.

Run: `git grep -n '"editor"\|"agent"' -- src tests`
Expected: no output.

- [ ] **Step 8: Check everything**

Run: `npx tsc --noEmit` — Expected: no output.
Run: `npx vitest run` — Expected: all pass.
Run: `npm run test:integration` — Expected: all pass.
Run: `npm run smoke` — Expected: `no runtime errors` (log in still works as `admin`, who is now owner).

- [ ] **Step 9: Commit**

```bash
git add src tests prisma/migrations/20261005010000_roles
git commit -m "company on the login, owner and staff roles, withAuth"
```

---

### Task 4: Every logged-in API route goes through withAuth

**Files:**
- Modify: every `src/app/api/**/route.ts` except the public ones listed below, plus `src/lib/realtime.ts`
- Create: `tests/unit/route-guard.test.ts`

**Interfaces:**
- Consumes: `withAuth`, `AuthContext` (Task 3), `currentCompanyId` (Task 1)
- Produces: no route file except the public list exports a plain `async function GET/POST/...`. Realtime channels are per company.

Public routes. These **don't** use withAuth. Task 5 handles them.
- `src/app/api/auth/route.ts`
- `src/app/api/health/route.ts`
- `src/app/api/openapi.json/route.ts`
- `src/app/api/channels/phone/incoming/route.ts`
- `src/app/api/channels/phone/gather/route.ts`
- `src/app/api/channels/phone/status/route.ts`
- `src/app/api/channels/sms/route.ts`
- `src/app/api/channels/telegram/route.ts`

- [ ] **Step 1: Guard test first**

Create `tests/unit/route-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const API = path.resolve(__dirname, "../../src/app/api");

const PUBLIC = new Set([
  "auth/route.ts",
  "health/route.ts",
  "openapi.json/route.ts",
  "channels/phone/incoming/route.ts",
  "channels/phone/gather/route.ts",
  "channels/phone/status/route.ts",
  "channels/sms/route.ts",
  "channels/telegram/route.ts",
]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const files = routeFiles(API).map((f) => path.relative(API, f).split(path.sep).join("/"));

describe("api routes", () => {
  it("found the route files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files.filter((f) => !PUBLIC.has(f)))("%s uses withAuth for every handler", (file) => {
    const src = readFileSync(path.join(API, file), "utf8");
    expect(src, "plain exported handler found").not.toMatch(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/);
    expect(src, "requireAuth used directly").not.toMatch(/\brequireAuth\(/);
    expect(src).toMatch(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=\s*withAuth\(/);
  });
});
```

Run: `npx vitest run tests/unit/route-guard.test.ts`
Expected: FAIL for about 60 files.

- [ ] **Step 2: Convert each route, same pattern every time**

Before:

```ts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request, "tickets:read");
  if (!isAuthenticated(auth)) return auth;

  try {
    // ...body...
  } catch (error) {
    // ...
  }
}
```

After:

```ts
export const GET = withAuth(
  "tickets:read",
  async (request: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    try {
      // ...body, unchanged...
    } catch (error) {
      // ...
    }
  }
);
```

Rules:
- The permission string moves from `requireAuth(request, X)` into `withAuth(X, ...)` unchanged.
- No route context → `async (request: NextRequest, auth) => { ... }`.
- If the body doesn't use `auth`, name it `_auth`.
- If the body doesn't use `request`, name it `_request`.
- Keep the function body exactly as it was. Only the wrapper changes.
- Remove `requireAuth` and `isAuthenticated` from the imports. Add `import { withAuth } from "@/lib/tenant/with-auth";`.
- Handlers declared with `request: Request` become `NextRequest`.

Routes that had **no** auth call, which the middleware only cookie-checks today. Give them these permissions:

| File | Handler | Permission |
|---|---|---|
| `chat/route.ts` | POST | `"conversations:create"` |
| `channels/email/route.ts` | GET | `"channels:read"` |
| `channels/email/route.ts` | POST | `"channels:update"` |
| `channels/whatsapp/route.ts` | GET | `"channels:read"` |
| `channels/whatsapp/route.ts` | POST | `"channels:update"` |
| `webhooks/test/route.ts` | POST | `"webhooks:update"` |
| `realtime/route.ts` | GET | `undefined` (any staff role) |

Work through the files in batches. After each batch, run `npx tsc --noEmit` and the guard test, so mistakes stay small. Keep `export const dynamic = ...` and other non-handler exports as they are.

- [ ] **Step 3: Realtime per company**

`src/lib/realtime.ts`:
- Add `import { currentCompanyId } from "@/lib/tenant/context";`.
- Add:

```ts
// subscribers and events are per company, so one company never sees another's events
function companyChannel(channel: string): string {
  return `${currentCompanyId()}:${channel}`;
}
```

- In `subscribe(channel, callback)` and in the publish function, use `companyChannel(channel)` wherever the map is read or written.
- Any helper that publishes to `"global"` or `conversation:${id}` goes through the same function.

Add to `tests/unit/realtime.test.ts`. This file imports the real module; check its top for `vi.unmock("@/lib/realtime")` or `vi.importActual`, and follow what it already does:

```ts
  it("keeps companies' events apart", async () => {
    const { runWithCompany } = await import("@/lib/tenant/context");
    const got: string[] = [];
    runWithCompany("a", () => subscribe("global", () => got.push("a")));
    runWithCompany("b", () => subscribe("global", () => got.push("b")));
    runWithCompany("a", () => publish("global", { type: "notification", data: {}, timestamp: "" }));
    expect(got).toEqual(["a"]);
  });
```

Use the module's real export names and payload shape. If `publish` has a different signature, adapt the call, not the assertion.

- [ ] **Step 4: Check everything**

Run: `npx vitest run tests/unit/route-guard.test.ts` — Expected: PASS for every route file.
Run: `npx tsc --noEmit` — Expected: no output.
Run: `npx vitest run` — Expected: all pass.
Run: `npm run test:integration` — Expected: all pass.
Run: `npm run smoke` — Expected: `no runtime errors`.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "every api route runs inside the user's company"
```

---

### Task 5: Entry points without a logged-in user, then fail closed

**Files:**
- Create: `src/lib/tenant/webhook-company.ts`, `tests/unit/webhook-company.test.ts`, `tests/integration/fail-closed.test.ts`
- Modify:
  - `src/lib/prisma.ts`
  - `src/app/(dashboard)/page.tsx`
  - the four Twilio routes and `channels/telegram/route.ts`
  - `src/lib/channels/whatsapp.ts`, `src/lib/channels/email.ts`
  - `scripts/encrypt-secrets.ts`, `src/lib/settings.ts` (`reencryptSecrets`)
  - `src/instrumentation.ts`
  - `src/app/api/health/route.ts`
  - tests touching these

**Interfaces:**
- Consumes: Tasks 1–4
- Produces:
  - `resolveWebhookCompany(request: NextRequest): Promise<string | null>`, which returns a company id or null
  - After this task, a scoped query with no company throws `MissingCompanyError`

- [ ] **Step 1: Webhook company, test first**

Create `tests/unit/webhook-company.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { systemPrisma } from "@/lib/prisma";
import { resolveWebhookCompany } from "@/lib/tenant/webhook-company";

const company = (systemPrisma as unknown as { company: Record<string, ReturnType<typeof vi.fn>> }).company;
const req = (url: string) => ({ nextUrl: new URL(url) }) as never;

beforeEach(() => {
  company.findUnique.mockReset();
  company.findMany.mockReset();
});

describe("resolveWebhookCompany", () => {
  it("uses ?company=<slug> when given", async () => {
    company.findUnique.mockResolvedValue({ id: "co-7" });
    expect(await resolveWebhookCompany(req("http://x/api/channels/sms?company=acme"))).toBe("co-7");
    expect(company.findUnique).toHaveBeenCalledWith({ where: { slug: "acme" }, select: { id: true } });
  });

  it("returns null for an unknown slug", async () => {
    company.findUnique.mockResolvedValue(null);
    expect(await resolveWebhookCompany(req("http://x/api/channels/sms?company=nope"))).toBeNull();
  });

  it("falls back to the only company when there is exactly one", async () => {
    company.findMany.mockResolvedValue([{ id: "only" }]);
    expect(await resolveWebhookCompany(req("http://x/api/channels/sms"))).toBe("only");
  });

  it("refuses to guess when there are several companies", async () => {
    company.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    expect(await resolveWebhookCompany(req("http://x/api/channels/sms"))).toBeNull();
  });
});
```

Run it — Expected: FAIL, cannot resolve module.

Create `src/lib/tenant/webhook-company.ts`:

```ts
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
```

Run it — Expected: PASS (4 tests).

- [ ] **Step 2: Webhook routes enter their company**

In each of `channels/phone/incoming`, `channels/phone/gather`, `channels/phone/status`, `channels/sms` and `channels/telegram`, change the handler so its whole existing body runs inside the company:

```ts
export async function POST(request: NextRequest) {
  const companyId = await resolveWebhookCompany(request);
  if (!companyId) {
    return new NextResponse("Unknown company", { status: 404 });
  }
  return runWithCompany(companyId, async () => {
    // ...existing body unchanged, including isTwilioRequestAllowed...
  });
}
```

Twilio routes return TwiML. Keep the 404 as plain text, as above. Update the Twilio route tests (`tests/api/twilio-routes.test.ts`) so `systemPrisma.company.findMany` resolves `[{ id: "test-company" }]` in their `beforeEach`. Add one test per route file: with two companies and no `?company=`, the route returns 404.

- [ ] **Step 3: Background listeners keep their company**

The WhatsApp and IMAP clients call our handlers from their own event loops, outside the request that started them.

`src/lib/channels/whatsapp.ts`:
- At the start of `initWhatsApp()`, capture the company:

```ts
  // the client is started from a logged-in request; its events must run as that company
  const companyId = currentCompanyId();
```

- Wrap the body of every `client.on(...)` callback that touches the database (`ready`, `disconnected`, `message`) in `await runWithCompany(companyId, async () => { ... })`.
- Above the module-level `let whatsappClient`, add the comment `// one whatsapp client per server for now; per-company clients come with the silent bot`.

`src/lib/channels/email.ts`: the same pattern in `startEmailListener()`. Capture `currentCompanyId()` at the start, and wrap the IMAP event callbacks that read or write the database.

- [ ] **Step 4: Dashboard page and scripts**

`src/app/(dashboard)/page.tsx` (a server component):
- Import `getCurrentUser` from `@/lib/auth`, `runWithCompany` from `@/lib/tenant/context`, and `redirect` from `next/navigation`.
- In `DashboardPage`, before using the stats:

```ts
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const stats = await runWithCompany(user.companyId, getStats);
```

- Keep how the page used `getStats()` before, and only change the call.

`src/lib/settings.ts` `reencryptSecrets()` stays per company. `scripts/encrypt-secrets.ts` loops over the companies:

```ts
import { systemPrisma } from "../src/lib/prisma";
import { runWithCompany } from "../src/lib/tenant/context";
// ...
const companies = await systemPrisma.company.findMany({ select: { id: true, slug: true } });
for (const c of companies) {
  const count = await runWithCompany(c.id, () => reencryptSecrets());
  console.log(`${c.slug}: encrypted ${count} fields`);
}
```

Keep the existing exit-code handling, so a failure exits 1 before anything later is written.

`src/instrumentation.ts` `checkStoredSecrets`: loop over `systemPrisma.company.findMany({ select: { id: true, slug: true } })`. For each company, run the existing probe inside `runWithCompany(c.id, ...)`, and log `company <slug>: ...` with the field names. Never log values. Keep the existing "never crash startup" behaviour and its test, updating the mocks for the loop.

`src/app/api/health/route.ts` (its `GET()` takes no request, and the tests call it that way):
- The AI reachability part reads settings, which now need a company.
- Use `const companies = await systemPrisma.company.findMany({ select: { id: true }, take: 2 });`.
- With exactly one company, run the existing check inside `runWithCompany(companies[0].id, ...)`.
- Otherwise report `checks.ai = "not_configured"`. A shared server shouldn't report one company's AI on a public endpoint.
- The `$queryRaw` database ping uses `systemPrisma`.
- Update `tests/api/health.test.ts` mocks accordingly (`company.findMany` → `[{ id: "test-company" }]`), and add one test: two companies → `ai` is `"not_configured"`.

- [ ] **Step 5: Fail closed, test first**

Create `tests/integration/fail-closed.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { MissingCompanyError } from "@/lib/tenant/context";

afterAll(async () => {
  await systemPrisma.$disconnect();
});

describe("no company in context", () => {
  it("refuses to read", async () => {
    await expect(prisma.customer.findMany()).rejects.toThrow(MissingCompanyError);
  });

  it("refuses to write", async () => {
    await expect(prisma.customer.create({ data: { name: "nobody" } })).rejects.toThrow(MissingCompanyError);
  });

  it("still allows the global Company table through the scoped client", async () => {
    await expect(prisma.company.findMany()).resolves.toBeInstanceOf(Array);
  });
});
```

Run: `npm run test:integration` — Expected: the first two FAIL (the fallback still answers).

The temporary fallback ended up in `src/lib/tenant/context.ts`, not `prisma.ts`, as `FALLBACK_COMPANY_ID` and `companyIdOrFallback()`. Its users are the prisma extension, `src/lib/tenant/keys.ts`, `src/lib/settings.ts` and the nested note create in `src/app/api/customers/route.ts`. Remove it:
- Delete `FALLBACK_COMPANY_ID` and `companyIdOrFallback()` from `context.ts`.
- Run `npx tsc --noEmit`. It now lists every caller.
- Change each caller to `currentCompanyId()`.
- Run `git grep -n "companyIdOrFallback\|FALLBACK_COMPANY_ID" -- src` — Expected: no output.

Run: `npm run test:integration` — Expected: all pass.

- [ ] **Step 6: Find anything still unscoped**

Run: `npx vitest run` — Expected: all pass. Any test that now throws `MissingCompanyError` shows a code path without a company. Fix it in the code, not by loosening the check. Unit tests use the mocked Prisma, so they won't hit the extension; this step mostly matters for the next two checks.

Run: `npm run smoke` (dev server restarted) — Expected: `no runtime errors`, every page loads, and the dev server log (`../helpdeskAI2-dev.log`) has no `MissingCompanyError`.

Run: `npm run db:seed` — Expected: `Seed data created successfully!`
Run: `npx tsx --env-file=.env scripts/encrypt-secrets.ts` — Expected: `default: encrypted N fields`.

Run: `git grep -n "systemPrisma" -- src ':!src/generated'`
Expected: only `src/lib/prisma.ts`, `src/lib/route-auth.ts`, `src/lib/auth.ts`, `src/app/api/auth/route.ts`, `src/lib/tenant/webhook-company.ts`, `src/instrumentation.ts`, `src/app/api/health/route.ts`. Anything else must be justified in the report or switched to `prisma`.

- [ ] **Step 7: Commit**

```bash
git add src tests scripts
git commit -m "set the company for webhooks, listeners and scripts, fail closed without one"
```

---

### Task 6: Per-company settings and unsigned webhooks

**Files:**
- Modify: `src/lib/settings.ts`, `tests/unit/settings-store.test.ts`, `src/lib/twilio-verify.ts`, `tests/api/twilio-routes.test.ts`, `.env.example`
- Create: `tests/integration/settings-per-company.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces: `getSettings()` / `saveSettings()` are per company (signatures unchanged). `saveSettings` runs its read and write in one transaction. Without a token, Twilio webhooks are refused unless `HELPLUS_ALLOW_UNSIGNED_WEBHOOKS=true`.

- [ ] **Step 1: Integration test for per-company settings**

Create `tests/integration/settings-per-company.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { getSettings, saveSettings } from "@/lib/settings";

const A = "it-settings-a";
const B = "it-settings-b";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({
    data: [
      { id: A, name: "A", slug: A },
      { id: B, name: "B", slug: B },
    ],
  });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("settings per company", () => {
  it("gives each company its own row", async () => {
    await runWithCompany(A, () => saveSettings({ businessName: "Alpha", aiApiKey: "sk-alpha" }));
    await runWithCompany(B, () => saveSettings({ businessName: "Beta" }));
    const a = await runWithCompany(A, getSettings);
    const b = await runWithCompany(B, getSettings);
    expect(a.businessName).toBe("Alpha");
    expect(a.aiApiKey).toBe("sk-alpha");
    expect(b.businessName).toBe("Beta");
    expect(b.aiApiKey).toBe("");
  });

  it("stores secrets encrypted", async () => {
    const raw = await systemPrisma.settings.findUnique({ where: { companyId: A } });
    expect(raw?.aiApiKey.startsWith("enc:v1:")).toBe(true);
  });

  it("creates a row on first read for a new company", async () => {
    const s = await runWithCompany(B, getSettings);
    expect(s.companyId).toBe(B);
  });
});
```

Run: `npm run test:integration`. These should already pass, because Task 2 switched settings to `companyId`. If any fail, fix `settings.ts` until they pass.

- [ ] **Step 2: One transaction in saveSettings**

In `src/lib/settings.ts`, `saveSettings` currently reads the existing row (for `dropStaleKeys`) and then upserts. Put both in one interactive transaction, so two saves at the same moment can't interleave:

```ts
  return prisma.$transaction(async (tx) => {
    const current = await tx.settings.findUnique({ where: { companyId: currentCompanyId() } });
    // ...existing dropStaleKeys + prepare logic, using `current`...
    const row = await tx.settings.upsert({
      where: { companyId: currentCompanyId() },
      update: data,
      create: { ...(data as Prisma.SettingsCreateInput) },
    });
    return decryptRow(row);
  });
```

Keep the existing logic and its order. Only move it inside the callback, and use `tx` instead of `prisma`. `tests/unit/settings-store.test.ts` uses the mocked Prisma, where `$transaction` is a bare `vi.fn()`. In that file's `beforeEach`, make it run the callback with the mock client: `mockPrisma.$transaction.mockImplementation(async (fn) => fn(mockPrisma))`. The global mock in `tests/setup.ts` stays as it is.

Run: `npx vitest run tests/unit/settings-store.test.ts` and `npm run test:integration` — Expected: PASS.

- [ ] **Step 3: Unsigned Twilio webhooks off by default**

Today, with no Twilio token set, webhooks are accepted without a signature check. Change `isTwilioRequestAllowed` in `src/lib/twilio-verify.ts`:
- **No token configured:** allow only when `process.env.HELPLUS_ALLOW_UNSIGNED_WEBHOOKS === "true"`. Otherwise refuse (the routes already turn a refusal into 403).
- **Token stored but can't be decrypted:** refuse (unchanged).
- **Token configured:** check the signature (unchanged).

Tests in `tests/api/twilio-routes.test.ts`:
- Change the "no token → 200" case to "no token → 403".
- Add "no token with `HELPLUS_ALLOW_UNSIGNED_WEBHOOKS=true` → 200". Set and restore the env var inside the test.

Append to `.env.example`:

```
# Accept Twilio webhooks without a signature when no Twilio token is set.
# Only for local testing. Leave unset in production.
# HELPLUS_ALLOW_UNSIGNED_WEBHOOKS="true"
```

- [ ] **Step 4: Business hours per company**

`BusinessHours` is still a single row with the global id `"default"`, so a second company's first save collides on the primary key. Give it the same treatment as Settings.

Integration test first. Add to `tests/integration/settings-per-company.test.ts`:

```ts
describe("business hours per company", () => {
  it("lets two companies save their own hours", async () => {
    const save = (tz: string) =>
      prisma.businessHours.upsert({
        where: { companyId: currentCompanyId() },
        update: { timezone: tz },
        create: { timezone: tz },
      });
    await runWithCompany(A, () => save("Asia/Kuala_Lumpur"));
    await runWithCompany(B, () => save("UTC"));
    const a = await runWithCompany(A, () => prisma.businessHours.findUnique({ where: { companyId: A } }));
    const b = await runWithCompany(B, () => prisma.businessHours.findUnique({ where: { companyId: B } }));
    expect(a?.timezone).toBe("Asia/Kuala_Lumpur");
    expect(b?.timezone).toBe("UTC");
  });
});
```

Add `prisma` and `currentCompanyId` to that file's imports. Run `npm run test:integration` — Expected: FAIL (`companyId` is not a unique field on `BusinessHours`).

Schema, in `model BusinessHours`:
- `id String @id @default("default")` → `id String @id @default(uuid())`
- `companyId String @default("")` → `companyId String @unique @default("")`
- Remove its `@@index([companyId])`.

Create `prisma/migrations/20261005020000_business_hours_per_company/migration.sql`:

```sql
ALTER TABLE "BusinessHours" ALTER COLUMN "id" DROP DEFAULT;
DROP INDEX "BusinessHours_companyId_idx";
CREATE UNIQUE INDEX "BusinessHours_companyId_key" ON "BusinessHours"("companyId");
```

Apply it to the dev database with psql (same command as the earlier migrations), then:
- `npx prisma db push && npx prisma generate` — Expected: already in sync.
- Apply to the test database: `DATABASE_URL="postgresql://helpplus:helpplus_dev_2026@localhost:5432/helpplus_test?schema=public" npx prisma db push`.
- Restart the dev server after `generate`.

`src/app/api/business-hours/route.ts`:
- Replace `where: { id: "default" }` (both the `findUnique` and the `upsert`) with `where: { companyId: currentCompanyId() }`.
- Remove any `id: "default"` from `create`.

Run: `git grep -n '"default"' -- src/app/api/business-hours` — Expected: no output.
Run: `npm run test:integration` — Expected: all pass. Update the business-hours unit tests if they assert the old `where`.

- [ ] **Step 5: Check everything**

Run: `npx tsc --noEmit` — Expected: no output.
Run: `npx vitest run` — Expected: all pass.
Run: `npm run test:integration` — Expected: all pass.
Run: `npm run lint` — Expected: 0 errors.
Run: `npm run smoke` — Expected: `no runtime errors`.
Run: `npx next build` (stop the dev server first, restart it afterwards) — Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src tests prisma .env.example
git commit -m "per-company settings and business hours, refuse unsigned twilio by default"
```

---

### Task 7: A row can only link to rows of its own company

The scope extension filters top-level queries, but a write can still put another company's id into a foreign key. For example, company B creates a ticket with `conversationId` set to one of company A's conversations. A later `include: { conversation }` would then show A's data to B. This task makes every write check that each linked id belongs to the current company.

**Files:**
- Create: `src/lib/tenant/links.ts`, `tests/unit/tenant-links.test.ts`, `tests/integration/cross-company-links.test.ts`
- Modify: `src/lib/prisma.ts`

**Interfaces:**
- Consumes: `scopeArgs`, `systemPrisma` and the extension (Task 2), `currentCompanyId` (Task 1, fail-closed after Task 5)
- Produces:
  - `LINKS: Record<string, Record<string, string>>`, mapping model → FK field → target model
  - `linkedIds(model: string, data: unknown): { field: string; target: string; id: string }[]`
  - `class CrossCompanyLinkError extends Error`

- [ ] **Step 1: Unit tests first**

Create `tests/unit/tenant-links.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { LINKS, linkedIds } from "@/lib/tenant/links";

describe("LINKS", () => {
  it("matches every foreign key in schema.prisma except companyId", () => {
    const schema = readFileSync(path.resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
    const found: Record<string, Record<string, string>> = {};
    let model = "";
    for (const line of schema.split("\n")) {
      const m = line.match(/^model (\w+)/);
      if (m) model = m[1];
      const rel = line.match(/^\s+\w+\s+(\w+)\??\s+@relation\(fields: \[(\w+)\]/);
      if (rel && rel[2] !== "companyId") {
        (found[model] ??= {})[rel[2]] = rel[1];
      }
    }
    expect(LINKS).toEqual(found);
  });
});

describe("linkedIds", () => {
  it("collects set foreign keys from one row", () => {
    expect(linkedIds("Ticket", { title: "x", conversationId: "c1", departmentId: null })).toEqual([
      { field: "conversationId", target: "Conversation", id: "c1" },
    ]);
  });

  it("collects from many rows and from Prisma's { set } form", () => {
    expect(
      linkedIds("ConversationTag", [{ conversationId: "c1", tagId: "t1" }, { conversationId: { set: "c2" }, tagId: "t1" }])
    ).toEqual([
      { field: "conversationId", target: "Conversation", id: "c1" },
      { field: "tagId", target: "Tag", id: "t1" },
      { field: "conversationId", target: "Conversation", id: "c2" },
    ]);
  });

  it("ignores models without links", () => {
    expect(linkedIds("Customer", { name: "x" })).toEqual([]);
  });
});
```

Run: `npx vitest run tests/unit/tenant-links.test.ts` — Expected: FAIL, cannot resolve module.

- [ ] **Step 2: Write links.ts**

Create `src/lib/tenant/links.ts`:

```ts
// foreign keys between company tables. every write checks these point at rows of the same company.
// tenant-links.test.ts fails if this drifts from schema.prisma.
export const LINKS: Record<string, Record<string, string>> = {
  KnowledgeEntry: { categoryId: "Category" },
  TeamMember: { departmentId: "Department" },
  Conversation: { customerId: "Customer" },
  Message: { conversationId: "Conversation" },
  Ticket: { conversationId: "Conversation", departmentId: "Department", assignedToId: "TeamMember" },
  ConversationTag: { conversationId: "Conversation", tagId: "Tag" },
  WebhookDelivery: { webhookId: "Webhook" },
  CustomerNote: { customerId: "Customer" },
  InternalNote: { conversationId: "Conversation" },
};

export class CrossCompanyLinkError extends Error {
  constructor(model: string, field: string) {
    super(`${model}.${field} points at a row of another company`);
    this.name = "CrossCompanyLinkError";
  }
}

function value(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "set" in v && typeof (v as { set: unknown }).set === "string") {
    return (v as { set: string }).set;
  }
  return null;
}

export function linkedIds(model: string, data: unknown): { field: string; target: string; id: string }[] {
  const fields = LINKS[model];
  if (!fields || !data) return [];
  const rows = Array.isArray(data) ? data : [data];
  const out: { field: string; target: string; id: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const [field, target] of Object.entries(fields)) {
      const id = value((row as Record<string, unknown>)[field]);
      if (!id || seen.has(`${field}:${id}`)) continue;
      seen.add(`${field}:${id}`);
      out.push({ field, target, id });
    }
  }
  return out;
}
```

Run the unit test — Expected: PASS (4 tests).

- [ ] **Step 3: Integration tests first**

Create `tests/integration/cross-company-links.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { CrossCompanyLinkError } from "@/lib/tenant/links";

const A = "it-links-a";
const B = "it-links-b";
let convA: string;
let tagA: string;

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({
    data: [
      { id: A, name: "A", slug: A },
      { id: B, name: "B", slug: B },
    ],
  });
  convA = (await runWithCompany(A, () => prisma.conversation.create({ data: { channel: "web", customerName: "x", customerContact: "x" } }))).id;
  tagA = (await runWithCompany(A, () => prisma.tag.create({ data: { name: "vip" } }))).id;
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("links across companies", () => {
  it("refuses to create a row linked to another company's row", async () => {
    await expect(
      runWithCompany(B, () => prisma.ticket.create({ data: { title: "t", description: "d", conversationId: convA } }))
    ).rejects.toThrow(CrossCompanyLinkError);
  });

  it("refuses to re-point an own row at another company's row", async () => {
    const t = await runWithCompany(B, () => prisma.ticket.create({ data: { title: "t", description: "d" } }));
    await expect(
      runWithCompany(B, () => prisma.ticket.update({ where: { id: t.id }, data: { conversationId: convA } }))
    ).rejects.toThrow(CrossCompanyLinkError);
  });

  it("refuses createMany with a foreign tag", async () => {
    const convB = await runWithCompany(B, () =>
      prisma.conversation.create({ data: { channel: "web", customerName: "y", customerContact: "y" } })
    );
    await expect(
      runWithCompany(B, () => prisma.conversationTag.createMany({ data: [{ conversationId: convB.id, tagId: tagA }] }))
    ).rejects.toThrow(CrossCompanyLinkError);
  });

  it("allows links inside the same company and empty links", async () => {
    const t = await runWithCompany(A, () =>
      prisma.ticket.create({ data: { title: "t", description: "d", conversationId: convA, departmentId: null } })
    );
    expect(t.conversationId).toBe(convA);
  });

  it("refuses a link to an id that doesn't exist", async () => {
    await expect(
      runWithCompany(A, () => prisma.ticket.create({ data: { title: "t", description: "d", conversationId: "nope" } }))
    ).rejects.toThrow(CrossCompanyLinkError);
  });
});
```

Check `Conversation` and `Ticket`'s required fields in `prisma/schema.prisma`, and set any other required ones (no default) in the `create` data above, keeping the intent. Run `npm run test:integration` — Expected: the first three and the last FAIL.

- [ ] **Step 4: Check links in the extension**

In `src/lib/prisma.ts`, inside `$allOperations`, after computing `companyId` and before `query(...)`, check the links of write operations. Use `systemPrisma` with an explicit `companyId`, so the check itself isn't re-scoped:

```ts
import { CrossCompanyLinkError, linkedIds } from "@/lib/tenant/links";

const WRITE_OPS = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn", "upsert"]);

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
```

Then, in the extension:

```ts
        const scoped = scopeArgs(model, operation, args as Record<string, unknown>, companyId);
        await assertLinksInCompany(model, operation, scoped, companyId);
        return query(scoped as typeof args);
```

Keep however the company id is obtained at that point (fallback or `currentCompanyId()`, depending on whether Task 5 is done).

Run: `npm run test:integration` — Expected: all pass.
Run: `npx vitest run` — Expected: all pass. Unit tests use the mocked Prisma, so the extension doesn't run there.

- [ ] **Step 5: Check everything**

Run: `npx tsc --noEmit` — Expected: no output.
Run: `npm run smoke` (restart the dev server first) — Expected: `no runtime errors`.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "check that links point at rows of the same company"
```

---

## Done when

- `npx vitest run`, `npm run test:integration`, `npx tsc --noEmit`, `npm run lint`, `npx next build` and `npm run smoke` all pass.
- Every table has `companyId`. Company A can't read, list, count, update, delete or move company B's rows. This is shown by real-database tests.
- A query with no company throws `MissingCompanyError`.
- Every logged-in API route uses `withAuth`, enforced by `route-guard.test.ts`.
- Webhooks pick their company from `?company=<slug>`, and refuse to guess when there are several companies.
- Roles are owner, admin, supervisor, staff, viewer and client. The first admin is now owner. Clients can't use dashboard APIs.
- Settings and business hours are one row per company, and secrets stay encrypted.
- A write can't link a row to another company's row (`CrossCompanyLinkError`). This is shown by real-database tests, and `tenant-links.test.ts` keeps the link list in step with the schema.

Not in this stage:
- Clients/projects and limiting staff to projects (stage 2)
- Company sign-up and billing
- One WhatsApp client per company (comes with the silent bot)
- A company switcher for users in several companies (a user belongs to one company)
