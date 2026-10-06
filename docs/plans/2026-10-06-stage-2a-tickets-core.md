# Stage 2A: Tickets Core and Clients/Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn tickets into the centre of Help+. Every issue is a numbered ticket with the new steps (New → AI Suggested → Answered → Closed, Reopened → Staff working). Each ticket belongs to a client/project and has an assigned staff login. Staff work from a ticket inbox and a ticket detail page, add issues with quick add, and see channel messages arrive as tickets.

**Architecture:** New `Project`, `ProjectAccess` and `TicketCounter` tables, and new columns on `Ticket` (number, projectId, assigneeId, source, category, timestamps). A ticket still owns one `Conversation`, which keeps the message thread and internal notes. Ticket rules live in `src/lib/tickets/`:
- `status.ts`: pure step rules
- `number.ts`: per-company numbering
- `access.ts`: which projects a user may see
- `service.ts`: creating tickets and attaching messages

The API routes and the new inbox UI call these. Staff with role `staff` or `viewer` only see projects they are given access to.

**Tech Stack:** Next.js 16 (app router, client components), Prisma 7 with the stage 1B tenant extension, PostgreSQL 18, Vitest (unit, plus real-database integration), lucide-react, Tailwind 4 with the Help+ tokens.

Spec: `docs/specs/2026-10-04-helplus-design.md`, sections "Structure" and "2. Tickets". This plan doesn't cover SLA timers, auto-close or email alerts; those are stage 2B.

## Global Constraints

- Code name `helplus`, display name "Help+". No "owly" anywhere except `LICENSE`.
- Comments only when needed, short and plain, written like a person would. No "This function...", no emoji.
- Commit messages short, lowercase, plain. No Co-Authored-By trailer. Commit locally only; push or open a PR only if the user asks.
- Before every commit, all of these pass:
  - `npx vitest run`
  - `npx tsc --noEmit`
  - `npm run test:integration`
- Look: indigo `#3B3FA6`, warm greys, IBM Plex, lucide icons, no emoji in UI. Status is shown as a coloured dot plus text. Text colours only `text-helplus-{text,text-light,link,danger,success,warning}` (the contrast guard test enforces this). It must work on phones.
- Every query goes through the scoped `prisma` (company filter). Use `systemPrisma` only where stage 1B allows it.
- Writes use scalar foreign keys, never `connect`. Nested relation writes are refused by the extension except `Customer.notes` create.
- The link check runs outside transactions, so a parent created in the same `$transaction` is invisible to it. Create parents and children in separate statements.
- Ticket text from any intake path is stored with IC numbers masked (`maskIC`).
- Statuses: `new`, `ai_suggested`, `answered`, `reopened`, `working`, `closed`. UI labels: New, AI Suggested, Answered, Reopened, Staff working, Closed.
- Local databases: ServBay Postgres. Dev db `helpplus`, test db `helpplus_test`, user `helpplus`, password `helpplus_dev_2026`. psql is at `/c/ServBay/packages/postgresql/18/bin/psql.exe`.

---

## Decisions this plan makes

- **"Handled by" means a staff login (`Admin`).** Tickets get a new `assigneeId`. The old `assignedToId` (TeamMember directory) stays in the schema for Owly's routing code but isn't shown in the new UI.
- **Projects carry the client/project idea.** One default project, "General", per company holds existing and unsorted tickets. People (`Customer`) can belong to a project.
- **Who sees which projects.** Owner, admin and supervisor see every project. Staff and viewer see only projects listed for them in `ProjectAccess`. Existing staff get access to "General" in the migration.
- **Replies aren't sent to the customer's channel.** A staff reply is saved on the ticket; staff still send it in WhatsApp themselves (spec phase 1). Sending to web-form clients comes with the help centre (stage 5).
- **The old Conversations page goes away.** `/conversations` redirects to `/tickets`, and the "Inbox" nav item is removed.

## File map

| File | Status | Job |
|---|---|---|
| `prisma/schema.prisma` | modify | Project, ProjectAccess, TicketCounter, Ticket columns, Customer.projectId, Settings.projectLabel |
| `prisma/migrations/20261006000000_tickets_core/migration.sql` | new | tables, backfill, numbering |
| `src/lib/tenant/links.ts` | modify | new links and relations |
| `src/lib/rbac.ts` | modify | `projects:read`, `projects:manage` |
| `src/lib/tickets/status.ts` | new | step rules |
| `src/lib/tickets/number.ts` | new | per-company ticket numbers |
| `src/lib/tickets/access.ts` | new | allowed projects for a user |
| `src/lib/tickets/service.ts` | new | open a ticket, quick add, attach incoming messages |
| `src/lib/projects/default.ts` | new | the company's default project |
| `src/app/api/tickets/**` | rewrite/new | list, create, detail, update, reply, notes, AI suggest |
| `src/app/api/projects/**` | new | projects and staff access |
| `src/app/api/company/route.ts` | new | name and project label for any logged-in user |
| `src/lib/ai/engine.ts`, `src/lib/ai/tools.ts`, `src/lib/conversation-engine.ts` and stats/analytics/dashboard | modify | incoming messages become tickets; new statuses |
| `src/components/tickets/*` | new | status badge, list, quick add, reply box |
| `src/app/(dashboard)/tickets/page.tsx`, `tickets/[id]/page.tsx` | rewrite/new | inbox and detail |
| `src/app/(dashboard)/projects/**` | new | clients/projects pages |
| `src/components/layout/nav-items.ts`, `src/lib/hooks/use-company.ts` | modify/new | nav changes, project label |

---

### Task 1: Database: projects, ticket numbers, new ticket fields

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/tenant/links.ts`, `src/lib/rbac.ts`, `tests/unit/rbac.test.ts`, `tests/setup.ts`
- Create: `prisma/migrations/20261006000000_tickets_core/migration.sql`, `tests/integration/tickets-schema.test.ts`

**Interfaces:**
- Produces:
  - Prisma models `Project { id, companyId, name, isDefault, archived }`, `ProjectAccess { id, companyId, projectId, adminId }` and `TicketCounter { id, companyId @unique, next }`.
  - New `Ticket` fields: `number`, `projectId`, `assigneeId?`, `source`, `category`, `firstReplyAt?`, `answeredAt?`, `closedAt?`, `reopenCount`, `aiMatch?`.
  - `Customer.projectId?` and `Settings.projectLabel`.
  - Permissions `"projects:read"` and `"projects:manage"`.

- [ ] **Step 1: Schema**

In `prisma/schema.prisma`:

Add to `model Company` (with the other back-relations):

```prisma
  projects          Project[]
  projectAccess     ProjectAccess[]
  ticketCounters    TicketCounter[]
```

Add these models after `model Company`:

```prisma
model Project {
  id        String          @id @default(uuid())
  companyId String          @default("")
  company   Company         @relation(fields: [companyId], references: [id], onDelete: Cascade)
  name      String
  isDefault Boolean         @default(false)
  archived  Boolean         @default(false)
  tickets   Ticket[]
  customers Customer[]
  access    ProjectAccess[]
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  @@unique([companyId, name])
  @@index([companyId])
}

model ProjectAccess {
  id        String   @id @default(uuid())
  companyId String   @default("")
  company   Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  projectId String
  project   Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  adminId   String
  admin     Admin    @relation(fields: [adminId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@unique([projectId, adminId])
  @@index([companyId])
  @@index([adminId])
}

model TicketCounter {
  id        String  @id @default(uuid())
  companyId String  @unique @default("")
  company   Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
  next      Int     @default(1)
}
```

In `model Admin`, add:

```prisma
  assignedTickets Ticket[]
  projectAccess   ProjectAccess[]
```

In `model Customer`, add:

```prisma
  projectId     String?
  project       Project?       @relation(fields: [projectId], references: [id], onDelete: SetNull)
```

and `@@index([projectId])`.

In `model Settings`, add `projectLabel    String   @default("Clients")`.

In `model Ticket`:
- Change `status String @default("open")` to `status String @default("new")`.
- Add:

```prisma
  number         Int
  projectId      String
  project        Project       @relation(fields: [projectId], references: [id])
  assigneeId     String?
  assignee       Admin?        @relation(fields: [assigneeId], references: [id], onDelete: SetNull)
  source         String        @default("quick_add")
  category       String        @default("")
  firstReplyAt   DateTime?
  answeredAt     DateTime?
  closedAt       DateTime?
  reopenCount    Int           @default(0)
  aiMatch        Int?
```

- Add `@@unique([companyId, number])`, `@@index([projectId])` and `@@index([assigneeId])`.

Run: `npx prisma validate` — Expected: valid.

- [ ] **Step 2: Migration**

Create `prisma/migrations/20261006000000_tickets_core/migration.sql`:

```sql
-- projects
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Project_companyId_name_key" ON "Project"("companyId", "name");
CREATE INDEX "Project_companyId_idx" ON "Project"("companyId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectAccess" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "projectId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectAccess_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectAccess_projectId_adminId_key" ON "ProjectAccess"("projectId", "adminId");
CREATE INDEX "ProjectAccess_companyId_idx" ON "ProjectAccess"("companyId");
CREATE INDEX "ProjectAccess_adminId_idx" ON "ProjectAccess"("adminId");
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TicketCounter" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "next" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "TicketCounter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TicketCounter_companyId_key" ON "TicketCounter"("companyId");
ALTER TABLE "TicketCounter" ADD CONSTRAINT "TicketCounter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- a default project per company
INSERT INTO "Project" ("id", "companyId", "name", "isDefault", "updatedAt")
SELECT gen_random_uuid()::text, c."id", 'General', true, CURRENT_TIMESTAMP FROM "Company" c;

-- existing staff and viewers can see the default project
INSERT INTO "ProjectAccess" ("id", "companyId", "projectId", "adminId")
SELECT gen_random_uuid()::text, a."companyId", p."id", a."id"
FROM "Admin" a JOIN "Project" p ON p."companyId" = a."companyId" AND p."isDefault"
WHERE a."role" IN ('staff', 'viewer');

-- people and settings
ALTER TABLE "Customer" ADD COLUMN "projectId" TEXT;
CREATE INDEX "Customer_projectId_idx" ON "Customer"("projectId");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Settings" ADD COLUMN "projectLabel" TEXT NOT NULL DEFAULT 'Clients';

-- ticket columns
ALTER TABLE "Ticket"
  ADD COLUMN "number" INTEGER,
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "assigneeId" TEXT,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'quick_add',
  ADD COLUMN "category" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "firstReplyAt" TIMESTAMP(3),
  ADD COLUMN "answeredAt" TIMESTAMP(3),
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "reopenCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "aiMatch" INTEGER;

-- every conversation without a ticket gets one, so nothing disappears from the inbox
INSERT INTO "Ticket" ("id", "companyId", "conversationId", "title", "description", "status", "priority", "source", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, cv."companyId", cv."id",
  COALESCE(
    NULLIF(LEFT((SELECT m."content" FROM "Message" m WHERE m."conversationId" = cv."id" AND m."role" = 'customer' ORDER BY m."createdAt" LIMIT 1), 80), ''),
    'Conversation with ' || cv."customerName"),
  '',
  CASE WHEN cv."status" IN ('resolved', 'closed') THEN 'closed' ELSE 'new' END,
  'medium', cv."channel", cv."createdAt", CURRENT_TIMESTAMP
FROM "Conversation" cv
WHERE NOT EXISTS (SELECT 1 FROM "Ticket" t WHERE t."conversationId" = cv."id");

-- old statuses to the new steps
UPDATE "Ticket" SET "status" = CASE "status"
  WHEN 'open' THEN 'new'
  WHEN 'in_progress' THEN 'working'
  WHEN 'resolved' THEN 'closed'
  ELSE "status" END;
UPDATE "Ticket" SET "closedAt" = "updatedAt" WHERE "status" = 'closed' AND "closedAt" IS NULL;
UPDATE "Ticket" t SET "source" = cv."channel"
FROM "Conversation" cv WHERE t."conversationId" = cv."id" AND t."source" = 'quick_add';

-- default project and per-company numbers
UPDATE "Ticket" t SET "projectId" = p."id" FROM "Project" p WHERE p."companyId" = t."companyId" AND p."isDefault";
UPDATE "Ticket" t SET "number" = n.rn
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "companyId" ORDER BY "createdAt", "id") AS rn FROM "Ticket") n
WHERE n."id" = t."id";
INSERT INTO "TicketCounter" ("id", "companyId", "next")
SELECT gen_random_uuid()::text, c."id", COALESCE((SELECT MAX(t."number") FROM "Ticket" t WHERE t."companyId" = c."id"), 0) + 1
FROM "Company" c;

ALTER TABLE "Ticket" ALTER COLUMN "number" SET NOT NULL;
ALTER TABLE "Ticket" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "Ticket" ALTER COLUMN "status" SET DEFAULT 'new';
CREATE UNIQUE INDEX "Ticket_companyId_number_key" ON "Ticket"("companyId", "number");
CREATE INDEX "Ticket_projectId_idx" ON "Ticket"("projectId");
CREATE INDEX "Ticket_assigneeId_idx" ON "Ticket"("assigneeId");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Apply to the dev database. Back it up first:

```bash
PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/pg_dump.exe -h localhost -U helpplus -d helpplus -Fc -f .superpowers/backup/helpplus-before-2a.dump
PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/psql.exe -h localhost -U helpplus -d helpplus -v ON_ERROR_STOP=1 -f prisma/migrations/20261006000000_tickets_core/migration.sql
npx prisma db push && npx prisma generate
```

Expected:
- psql ends with no `ERROR`.
- `db push` says the database is already in sync. If it wants to drop or change anything beyond index names, stop and report.

Apply to the test database. It has `_prisma_migrations` from the stage 1B replay:

```bash
DATABASE_URL="postgresql://helpplus:helpplus_dev_2026@localhost:5432/helpplus_test?schema=public" npx prisma migrate deploy
```

Expected: `1 migration applied`.

Check the dev data:

```bash
PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/psql.exe -h localhost -U helpplus -d helpplus -tAc 'select count(*), count(distinct "number"), min("number"), max("number") from "Ticket"; select "next" from "TicketCounter"; select name, "isDefault" from "Project";'
```

Expected:
- every ticket has a distinct number from 1 to N
- the counter is N+1
- one project, `General|t`

Restart the dev server, because the client was regenerated:
1. Stop the process on :3000.
2. Run `npm run dev > ../helpdeskAI2-dev.log 2>&1 &`.

- [ ] **Step 3: Links, relations, permissions**

`src/lib/tenant/links.ts`, add to `LINKS`:

```ts
  Project: {},
  ProjectAccess: { projectId: "Project", adminId: "Admin" },
  Customer: { projectId: "Project" },
  Ticket: {
    conversationId: "Conversation",
    departmentId: "Department",
    assignedToId: "TeamMember",
    projectId: "Project",
    assigneeId: "Admin",
  },
```

- Keep the other entries.
- Merge these with the existing `Ticket` entry rather than adding a second one.
- Leave out `Project: {}` if the guard test expects only models that have foreign keys.

Add the matching relation fields to `RELATIONS`: `Project.tickets`, `Project.customers`, `Project.access`, `ProjectAccess.project`, `ProjectAccess.admin`, `Admin.assignedTickets`, `Admin.projectAccess`, `Customer.project`, `Ticket.project`, `Ticket.assignee`. Use the same shape as the existing entries.

Run `npx vitest run tests/unit/tenant-links.test.ts` and adjust both maps until it passes. The test derives the expected maps from `schema.prisma`, so follow what it reports. Don't edit the test.

`src/lib/rbac.ts`, add before `"company:manage"`:

```ts
  // Projects (clients)
  "projects:read": ["viewer", "staff", "supervisor", "admin", "owner"],
  "projects:manage": ["admin", "owner"],
```

`tests/unit/rbac.test.ts`, add:

```ts
  it("only admins and owners manage projects", () => {
    expect(hasPermission("staff", "projects:read")).toBe(true);
    expect(hasPermission("staff", "projects:manage")).toBe(false);
    expect(hasPermission("admin", "projects:manage")).toBe(true);
  });
```

`tests/setup.ts`: add `"project"`, `"projectAccess"` and `"ticketCounter"` to the mocked `models` list.

- [ ] **Step 4: Integration test for the schema**

Create `tests/integration/tickets-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { CrossCompanyLinkError } from "@/lib/tenant/links";

const A = "it-2a-a";
const B = "it-2a-b";

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

describe("tickets core schema", () => {
  it("numbers are unique per company, not globally", async () => {
    const make = (company: string) =>
      runWithCompany(company, async () => {
        const p = await prisma.project.create({ data: { name: "General", isDefault: true } });
        return prisma.ticket.create({ data: { number: 1, title: "t", description: "", projectId: p.id } });
      });
    const a = await make(A);
    const b = await make(B);
    expect([a.number, b.number]).toEqual([1, 1]);
  });

  it("a ticket can't use another company's project", async () => {
    const pA = await runWithCompany(A, () => prisma.project.findFirstOrThrow({ where: { isDefault: true } }));
    await expect(
      runWithCompany(B, () => prisma.ticket.create({ data: { number: 2, title: "t", description: "", projectId: pA.id } }))
    ).rejects.toThrow(CrossCompanyLinkError);
  });

  it("new tickets start as new", async () => {
    const t = await runWithCompany(A, async () => {
      const p = await prisma.project.findFirstOrThrow({ where: { isDefault: true } });
      return prisma.ticket.create({ data: { number: 3, title: "t", description: "", projectId: p.id } });
    });
    expect(t.status).toBe("new");
    expect(t.reopenCount).toBe(0);
  });
});
```

Run: `npm run test:integration` — Expected: all pass.

- [ ] **Step 5: Check and commit**

Run:
- `npx tsc --noEmit` — Expected: the only errors are in files that create tickets without `number`/`projectId` (`src/app/api/tickets/route.ts`, `src/lib/ai/tools.ts`). Tasks 2 and 3 fix those.
- To keep this commit green, add `// @ts-expect-error fixed in the next task` above those two `prisma.ticket.create` calls.
- Run `npx tsc --noEmit` again — Expected: clean.
- `npx vitest run` — Expected: all pass.

```bash
git add prisma src tests
git commit -m "projects, ticket numbers and new ticket fields"
```

---

### Task 2: Ticket rules: steps, numbers, access, service

**Files:**
- Create: `src/lib/tickets/status.ts`, `src/lib/tickets/number.ts`, `src/lib/tickets/access.ts`, `src/lib/tickets/service.ts`, `src/lib/projects/default.ts`
- Test: `tests/unit/ticket-status.test.ts`, `tests/unit/ticket-access.test.ts`, `tests/integration/ticket-service.test.ts`
- Modify: `src/lib/ai/tools.ts` (use `openTicket`, remove the `@ts-expect-error`)

**Interfaces:**
- Consumes: Task 1 models, `currentCompanyId`, `maskIC`, the scoped `prisma`
- Produces:
  - `TICKET_STATUSES`, `type TicketStatus`, `OPEN_STATUSES: TicketStatus[]`, `STATUS_LABELS: Record<TicketStatus, string>`, `isTicketStatus(v: unknown): v is TicketStatus`
  - `statusChange(current: { status: string; firstReplyAt: Date | null; reopenCount: number }, to: TicketStatus, now?: Date): Record<string, unknown>`, which throws `InvalidTransitionError`
  - `nextTicketNumber(): Promise<number>`
  - `defaultProjectId(): Promise<string>`
  - `allowedProjectIds(auth: { role: string; userId: string }): Promise<string[] | null>` (`null` means all projects) and `projectWhere(ids: string[] | null): Record<string, unknown>`
  - `titleFrom(text: string): string`
  - `openTicket(input: { conversationId: string; title?: string; description: string; source: string; projectId?: string; priority?: string; category?: string }): Promise<Ticket>`
  - `createTicket(input: { text: string; title?: string; projectId?: string; source?: string; customerName?: string; customerContact?: string; category?: string; priority?: string }): Promise<Ticket>`
  - `ticketForIncomingMessage(conversationId: string, text: string): Promise<Ticket>`

- [ ] **Step 1: Status rules, test first**

Create `tests/unit/ticket-status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { statusChange, InvalidTransitionError, isTicketStatus, OPEN_STATUSES } from "@/lib/tickets/status";

const now = new Date("2026-10-06T10:00:00Z");
const base = { status: "new", firstReplyAt: null, reopenCount: 0 };

describe("statusChange", () => {
  it("answering sets answeredAt and the first reply time", () => {
    expect(statusChange(base, "answered", now)).toEqual({ status: "answered", answeredAt: now, firstReplyAt: now });
  });

  it("keeps an earlier first reply time", () => {
    const earlier = new Date("2026-10-05T10:00:00Z");
    const out = statusChange({ ...base, status: "working", firstReplyAt: earlier }, "answered", now);
    expect(out.firstReplyAt).toBeUndefined();
  });

  it("closing sets closedAt", () => {
    expect(statusChange({ ...base, status: "answered" }, "closed", now)).toEqual({ status: "closed", closedAt: now });
  });

  it("reopening counts and clears closedAt", () => {
    expect(statusChange({ ...base, status: "closed", reopenCount: 1 }, "reopened", now)).toEqual({
      status: "reopened",
      reopenCount: 2,
      closedAt: null,
    });
  });

  it("refuses jumps that skip a step", () => {
    expect(() => statusChange({ ...base, status: "closed" }, "answered", now)).toThrow(InvalidTransitionError);
    expect(() => statusChange(base, "reopened", now)).toThrow(InvalidTransitionError);
  });

  it("does nothing when the status doesn't change", () => {
    expect(statusChange(base, "new", now)).toEqual({});
  });

  it("treats an unknown old status as new", () => {
    expect(statusChange({ ...base, status: "open" }, "working", now)).toEqual({ status: "working" });
  });
});

describe("status helpers", () => {
  it("knows the open statuses", () => {
    expect(OPEN_STATUSES).not.toContain("closed");
    expect(isTicketStatus("ai_suggested")).toBe(true);
    expect(isTicketStatus("resolved")).toBe(false);
  });
});
```

Run it — Expected: FAIL, module not found.

Create `src/lib/tickets/status.ts`:

```ts
export const TICKET_STATUSES = ["new", "ai_suggested", "answered", "reopened", "working", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const OPEN_STATUSES: TicketStatus[] = ["new", "ai_suggested", "answered", "reopened", "working"];

export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: "New",
  ai_suggested: "AI Suggested",
  answered: "Answered",
  reopened: "Reopened",
  working: "Staff working",
  closed: "Closed",
};

// which step can follow which. closed only goes back via reopened.
const ALLOWED: Record<TicketStatus, TicketStatus[]> = {
  new: ["ai_suggested", "working", "answered", "closed"],
  ai_suggested: ["working", "answered", "closed"],
  answered: ["reopened", "working", "closed"],
  reopened: ["working", "answered", "closed"],
  working: ["answered", "closed"],
  closed: ["reopened"],
};

export class InvalidTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`can't move a ticket from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function isTicketStatus(v: unknown): v is TicketStatus {
  return typeof v === "string" && (TICKET_STATUSES as readonly string[]).includes(v);
}

export function statusChange(
  current: { status: string; firstReplyAt: Date | null; reopenCount: number },
  to: TicketStatus,
  now: Date = new Date()
): Record<string, unknown> {
  const from: TicketStatus = isTicketStatus(current.status) ? current.status : "new";
  if (from === to) return {};
  if (!ALLOWED[from].includes(to)) throw new InvalidTransitionError(from, to);

  const data: Record<string, unknown> = { status: to };
  if (to === "answered") {
    data.answeredAt = now;
    if (!current.firstReplyAt) data.firstReplyAt = now;
  }
  if (to === "closed") data.closedAt = now;
  if (to === "reopened") {
    data.reopenCount = current.reopenCount + 1;
    data.closedAt = null;
  }
  return data;
}
```

Run it — Expected: PASS (8 tests).

- [ ] **Step 2: Access rule, test first**

Create `tests/unit/ticket-access.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { allowedProjectIds, projectWhere } from "@/lib/tickets/access";

const access = (prisma as unknown as { projectAccess: { findMany: ReturnType<typeof vi.fn> } }).projectAccess;

beforeEach(() => access.findMany.mockReset());

describe("allowedProjectIds", () => {
  it.each(["owner", "admin", "supervisor"])("%s sees every project", async (role) => {
    expect(await allowedProjectIds({ role, userId: "u1" })).toBeNull();
    expect(access.findMany).not.toHaveBeenCalled();
  });

  it.each(["staff", "viewer"])("%s sees only listed projects", async (role) => {
    access.findMany.mockResolvedValue([{ projectId: "p1" }, { projectId: "p2" }]);
    expect(await allowedProjectIds({ role, userId: "u1" })).toEqual(["p1", "p2"]);
    expect(access.findMany).toHaveBeenCalledWith({ where: { adminId: "u1" }, select: { projectId: true } });
  });

  it("anyone else sees nothing", async () => {
    expect(await allowedProjectIds({ role: "client", userId: "u1" })).toEqual([]);
  });
});

describe("projectWhere", () => {
  it("adds no filter for null", () => {
    expect(projectWhere(null)).toEqual({});
  });

  it("filters by the listed projects", () => {
    expect(projectWhere(["p1"])).toEqual({ projectId: { in: ["p1"] } });
  });
});
```

Create `src/lib/tickets/access.ts`:

```ts
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
```

Run both unit tests — Expected: PASS.

- [ ] **Step 3: Numbers, default project and service, test first**

Create `tests/integration/ticket-service.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { nextTicketNumber } from "@/lib/tickets/number";
import { createTicket, ticketForIncomingMessage, openTicket } from "@/lib/tickets/service";
import { defaultProjectId } from "@/lib/projects/default";

const A = "it-2a-svc-a";
const B = "it-2a-svc-b";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);

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

describe("ticket numbers", () => {
  it("count up per company from 1", async () => {
    expect(await asA(nextTicketNumber)).toBe(1);
    expect(await asA(nextTicketNumber)).toBe(2);
    expect(await runWithCompany(B, nextTicketNumber)).toBe(1);
  });

  it("don't repeat under concurrency", async () => {
    const nums = await Promise.all(Array.from({ length: 10 }, () => asA(nextTicketNumber)));
    expect(new Set(nums).size).toBe(10);
  });
});

describe("default project", () => {
  it("is created once and reused", async () => {
    const a = await asA(defaultProjectId);
    expect(await asA(defaultProjectId)).toBe(a);
    const p = await asA(() => prisma.project.findUnique({ where: { id: a } }));
    expect(p?.name).toBe("General");
  });
});

describe("createTicket (quick add)", () => {
  it("makes a conversation, the first message and a numbered ticket, with IC hidden", async () => {
    const t = await asA(() =>
      createTicket({ text: "IC saya 900101-14-5678 tak boleh login\nTolong", customerName: "Aminah" })
    );
    expect(t.title).toBe("IC saya [IC HIDDEN] tak boleh login");
    expect(t.description).toContain("[IC HIDDEN]");
    expect(t.status).toBe("new");
    expect(t.source).toBe("quick_add");
    const msgs = await asA(() => prisma.message.findMany({ where: { conversationId: t.conversationId! } }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).not.toContain("900101");
  });
});

describe("ticketForIncomingMessage", () => {
  it("opens a ticket for a new conversation, then keeps using it", async () => {
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "whatsapp" } }));
    const first = await asA(() => ticketForIncomingMessage(conv.id, "Report kosong"));
    const second = await asA(() => ticketForIncomingMessage(conv.id, "masih kosong"));
    expect(second.id).toBe(first.id);
    expect(first.source).toBe("whatsapp");
  });

  it("opens a new ticket once the old one is closed", async () => {
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "sms" } }));
    const first = await asA(() => ticketForIncomingMessage(conv.id, "one"));
    await asA(() => prisma.ticket.update({ where: { id: first.id }, data: { status: "closed" } }));
    const next = await asA(() => ticketForIncomingMessage(conv.id, "two"));
    expect(next.id).not.toBe(first.id);
  });

  it("openTicket uses the given project", async () => {
    const p = await asA(() => prisma.project.create({ data: { name: "Alpha" } }));
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "web" } }));
    const t = await asA(() => openTicket({ conversationId: conv.id, description: "x", source: "web_form", projectId: p.id }));
    expect(t.projectId).toBe(p.id);
  });
});
```

Run: `npm run test:integration` — Expected: FAIL, modules not found.

Create `src/lib/tickets/number.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { currentCompanyId } from "@/lib/tenant/context";

// counter row per company; the update is a single atomic increment.
// the first ever call can race on the insert, so retry once on a unique clash.
export async function nextTicketNumber(): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    try {
      const counter = await prisma.ticketCounter.upsert({
        where: { companyId: currentCompanyId() },
        update: { next: { increment: 1 } },
        create: { next: 2 },
      });
      return counter.next - 1;
    } catch (error) {
      if (attempt === 0 && (error as { code?: string }).code === "P2002") continue;
      throw error;
    }
  }
}
```

Create `src/lib/projects/default.ts`:

```ts
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
```

Create `src/lib/tickets/service.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { maskIC } from "@/lib/privacy/ic-mask";
import { defaultProjectId } from "@/lib/projects/default";
import { nextTicketNumber } from "./number";
import { OPEN_STATUSES } from "./status";

export function titleFrom(text: string): string {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!line) return "New issue";
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}

export interface OpenTicketInput {
  conversationId: string;
  title?: string;
  description: string;
  source: string;
  projectId?: string;
  priority?: string;
  category?: string;
}

// parent rows are created before this runs: the link check can't see rows from an open transaction
export async function openTicket(input: OpenTicketInput) {
  const description = maskIC(input.description).text;
  const title = maskIC(input.title?.trim() || titleFrom(description)).text;
  return prisma.ticket.create({
    data: {
      number: await nextTicketNumber(),
      title,
      description,
      source: input.source,
      projectId: input.projectId || (await defaultProjectId()),
      priority: input.priority ?? "medium",
      category: input.category ?? "",
      status: "new",
      conversationId: input.conversationId,
    },
  });
}

export interface CreateTicketInput {
  text: string;
  title?: string;
  projectId?: string;
  source?: string;
  customerName?: string;
  customerContact?: string;
  category?: string;
  priority?: string;
}

export async function createTicket(input: CreateTicketInput) {
  const source = input.source ?? "quick_add";
  const text = maskIC(input.text).text;
  const conversation = await prisma.conversation.create({
    data: {
      channel: source,
      customerName: input.customerName?.trim() || "Unknown",
      customerContact: input.customerContact?.trim() || "",
    },
  });
  await prisma.message.create({ data: { conversationId: conversation.id, role: "customer", content: text } });
  return openTicket({
    conversationId: conversation.id,
    title: input.title,
    description: text,
    source,
    projectId: input.projectId,
    priority: input.priority,
    category: input.category,
  });
}

export async function ticketForIncomingMessage(conversationId: string, text: string) {
  const open = await prisma.ticket.findFirst({
    where: { conversationId, status: { in: OPEN_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (open) {
    return prisma.ticket.update({ where: { id: open.id }, data: { updatedAt: new Date() } });
  }
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { channel: true } });
  return openTicket({ conversationId, description: text, source: conversation?.channel ?? "api" });
}
```

Run: `npm run test:integration` — Expected: all pass.

- [ ] **Step 4: The AI tool creates tickets through the service**

`src/lib/ai/tools.ts`, in `createTicket` (the tool handler):
- Remove the `@ts-expect-error` line.
- Replace the `prisma.ticket.create({...})` with:

```ts
  if (!conversationId) {
    return JSON.stringify({ success: false, message: "No conversation to attach the ticket to." });
  }
  const ticket = await openTicket({
    conversationId,
    title: args.title as string,
    description: (args.description as string) ?? "",
    source: "ai",
    priority: (args.priority as string) || "medium",
  });
  if (department) {
    await prisma.ticket.update({ where: { id: ticket.id }, data: { departmentId: department.id } });
  }
```

- Import `openTicket` from `@/lib/tickets/service`.
- In `assignToPerson`, change `status: "in_progress"` to `status: "working"`.
- Change the success message to use the number: `` `Ticket #${ticket.number} created: ${ticket.title} (Priority: ${ticket.priority})` ``.

Update `tests/unit/ai-tools.test.ts` for the new path: mock `ticketCounter.upsert` to resolve `{ next: 2 }`, and `project.findFirst` to resolve `{ id: "p1" }`. Keep the intent of each test.

- [ ] **Step 5: Check and commit**

Run:
- `npx tsc --noEmit` — Expected: clean except the remaining `@ts-expect-error` in `src/app/api/tickets/route.ts` (Task 3 removes it).
- `npx vitest run` — Expected: all pass.
- `npm run test:integration` — Expected: all pass.

```bash
git add src tests
git commit -m "ticket steps, numbers, project access and the ticket service"
```

---

### Task 3: Ticket API

**Files:**
- Rewrite: `src/app/api/tickets/route.ts`, `src/app/api/tickets/[id]/route.ts`
- Create: `src/app/api/tickets/[id]/messages/route.ts`, `src/app/api/tickets/[id]/notes/route.ts`, `src/app/api/tickets/suggest/route.ts`
- Modify: `src/lib/validations.ts`, `tests/api/tickets.test.ts` (rewrite), and the files listed in Step 6
- Create: `tests/api/ticket-detail.test.ts`

**Interfaces:**
- Consumes: Task 2 (everything), `withAuth`, `paginatedResponse`/`parsePagination`, `chatCompletion`/`chatConfig`/`isConfigured`, `getSettings`, `emitNewMessage`
- Produces (HTTP):
  - `GET /api/tickets?status=open|all|<s>[,<s>]&projectId=&assignee=me|unassigned|<adminId>&source=&q=&page=&limit=` → `{ data: TicketRow[], pagination, counts: Record<TicketStatus, number> }`
  - `POST /api/tickets` with `{ text, title?, projectId?, customerName?, customerContact?, category?, priority? }` → 201 ticket
  - `GET /api/tickets/:id` → ticket with `project`, `assignee`, `conversation { messages[], notes[] }`
  - `PATCH /api/tickets/:id` with `{ status?, assigneeId?, priority?, category?, projectId?, title? }`
  - `DELETE /api/tickets/:id`
  - `POST /api/tickets/:id/messages` with `{ content, markAnswered? = true }`
  - `GET|POST /api/tickets/:id/notes` with `{ content }`
  - `POST /api/tickets/suggest` with `{ text }` → `{ title, category }`
- `TicketRow` = ticket plus `project: { id, name }`, `assignee: { id, name } | null` and `conversation: { customerName, customerContact, channel } | null`.

- [ ] **Step 1: Validation schemas**

In `src/lib/validations.ts`, replace `createTicketSchema` and `updateTicketSchema` with:

```ts
const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
const STATUSES = ["new", "ai_suggested", "answered", "reopened", "working", "closed"] as const;

export const createTicketSchema = z.object({
  text: z.string().trim().min(1, "Describe the issue").max(20000),
  title: z.string().max(200).optional(),
  projectId: z.string().max(100).optional(),
  customerName: z.string().max(200).optional(),
  customerContact: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  priority: z.enum(PRIORITIES).optional(),
});

export const updateTicketSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    assigneeId: z.string().max(100).nullable().optional(),
    priority: z.enum(PRIORITIES).optional(),
    category: z.string().max(100).optional(),
    projectId: z.string().max(100).optional(),
    title: z.string().min(1).max(200).optional(),
  })
  .strict();

export const ticketReplySchema = z.object({
  content: z.string().trim().min(1).max(20000),
  markAnswered: z.boolean().optional(),
});

export const ticketNoteSchema = z.object({
  content: z.string().trim().min(1).max(10000),
});
```

If any other file imports the old fields of these schemas, `tsc` will point to it. Fix those to the new shape.

- [ ] **Step 2: API tests first**

Rewrite `tests/api/tickets.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest, parseJsonResponse } from "../helpers/request";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const asRole = (role: string) =>
  vi.mocked(requireAuth).mockResolvedValue({
    userId: "u1",
    role,
    username: "u",
    name: "U",
    authMethod: "cookie",
    companyId: "test-company",
  } as never);

beforeEach(() => {
  for (const m of ["ticket", "projectAccess", "project", "conversation", "message", "ticketCounter"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  asRole("admin");
  db.ticket.findMany.mockResolvedValue([{ id: "t1", number: 1, status: "new" }]);
  db.ticket.count.mockResolvedValue(1);
  db.ticket.groupBy.mockResolvedValue([{ status: "new", _count: { _all: 1 } }]);
});

describe("GET /api/tickets", () => {
  it("lists tickets with status counts", async () => {
    const { GET } = await import("@/app/api/tickets/route");
    const res = await GET(createRequest("/api/tickets"), {} as never);
    const body = await parseJsonResponse(res);
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.counts.new).toBe(1);
    expect(body.counts.closed).toBe(0);
  });

  it("status=open means every status except closed", async () => {
    const { GET } = await import("@/app/api/tickets/route");
    await GET(createRequest("/api/tickets?status=open"), {} as never);
    const where = db.ticket.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"status":{"in":["new","ai_suggested","answered","reopened","working"]}');
  });

  it("limits staff to their projects", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    const { GET } = await import("@/app/api/tickets/route");
    await GET(createRequest("/api/tickets"), {} as never);
    const where = db.ticket.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"projectId":{"in":["p1"]}');
  });

  it("assignee=me filters by the logged-in user", async () => {
    const { GET } = await import("@/app/api/tickets/route");
    await GET(createRequest("/api/tickets?assignee=me"), {} as never);
    expect(JSON.stringify(db.ticket.findMany.mock.calls[0][0].where)).toContain('"assigneeId":"u1"');
  });
});

describe("POST /api/tickets", () => {
  it("rejects an empty description", async () => {
    const { POST } = await import("@/app/api/tickets/route");
    const res = await POST(createRequest("/api/tickets", { method: "POST", body: { text: "  " } }), {} as never);
    expect(res.status).toBe(400);
  });

  it("refuses a project the staff member can't see", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    const { POST } = await import("@/app/api/tickets/route");
    const res = await POST(createRequest("/api/tickets", { method: "POST", body: { text: "x", projectId: "p2" } }), {} as never);
    expect(res.status).toBe(403);
  });

  it("creates a ticket", async () => {
    db.conversation.create.mockResolvedValue({ id: "c1" });
    db.message.create.mockResolvedValue({ id: "m1" });
    db.ticketCounter.upsert.mockResolvedValue({ next: 8 });
    db.project.findFirst.mockResolvedValue({ id: "p1" });
    db.ticket.create.mockResolvedValue({ id: "t9", number: 7 });
    const { POST } = await import("@/app/api/tickets/route");
    const res = await POST(createRequest("/api/tickets", { method: "POST", body: { text: "Report kosong" } }), {} as never);
    expect(res.status).toBe(201);
    expect(db.ticket.create.mock.calls[0][0].data.number).toBe(7);
  });
});
```

Create `tests/api/ticket-detail.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest, parseJsonResponse } from "../helpers/request";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ctx = { params: Promise.resolve({ id: "t1" }) };
const ticket = {
  id: "t1",
  number: 5,
  status: "working",
  projectId: "p1",
  firstReplyAt: null,
  reopenCount: 0,
  conversationId: "c1",
};

beforeEach(() => {
  for (const m of ["ticket", "projectAccess", "message", "internalNote", "admin"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  vi.mocked(requireAuth).mockResolvedValue({
    userId: "u1",
    role: "admin",
    username: "u",
    name: "Aisyah",
    authMethod: "cookie",
    companyId: "test-company",
  } as never);
  db.ticket.findUnique.mockResolvedValue(ticket);
  db.ticket.update.mockImplementation(async ({ data }) => ({ ...ticket, ...data }));
});

describe("PATCH /api/tickets/:id", () => {
  it("moves through the allowed steps and stamps times", async () => {
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const res = await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { status: "answered" } }), ctx);
    expect(res.status).toBe(200);
    const data = db.ticket.update.mock.calls[0][0].data;
    expect(data.status).toBe("answered");
    expect(data.firstReplyAt).toBeInstanceOf(Date);
  });

  it("refuses a jump that skips a step", async () => {
    db.ticket.findUnique.mockResolvedValue({ ...ticket, status: "closed" });
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const res = await PATCH(createRequest("/api/tickets/t1", { method: "PATCH", body: { status: "answered" } }), ctx);
    expect(res.status).toBe(409);
  });

  it("hides tickets in projects the staff member can't see", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      userId: "u2",
      role: "staff",
      username: "s",
      name: "S",
      authMethod: "cookie",
      companyId: "test-company",
    } as never);
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "other" }]);
    const { GET } = await import("@/app/api/tickets/[id]/route");
    const res = await GET(createRequest("/api/tickets/t1"), ctx);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/tickets/:id/messages", () => {
  it("saves the staff reply and marks the ticket answered", async () => {
    db.message.create.mockResolvedValue({ id: "m1", role: "agent", content: "Sila cuba lagi" });
    const { POST } = await import("@/app/api/tickets/[id]/messages/route");
    const res = await POST(
      createRequest("/api/tickets/t1/messages", { method: "POST", body: { content: "Sila cuba lagi" } }),
      ctx
    );
    expect(res.status).toBe(201);
    expect(db.message.create.mock.calls[0][0].data).toMatchObject({ conversationId: "c1", role: "agent" });
    expect(db.ticket.update.mock.calls[0][0].data.status).toBe("answered");
  });

  it("can reply without changing the step", async () => {
    db.message.create.mockResolvedValue({ id: "m1" });
    const { POST } = await import("@/app/api/tickets/[id]/messages/route");
    await POST(
      createRequest("/api/tickets/t1/messages", { method: "POST", body: { content: "noted", markAnswered: false } }),
      ctx
    );
    const data = db.ticket.update.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
    expect(data.firstReplyAt).toBeInstanceOf(Date);
  });

  it("won't reply on a closed ticket", async () => {
    db.ticket.findUnique.mockResolvedValue({ ...ticket, status: "closed" });
    const { POST } = await import("@/app/api/tickets/[id]/messages/route");
    const res = await POST(createRequest("/api/tickets/t1/messages", { method: "POST", body: { content: "x" } }), ctx);
    expect(res.status).toBe(409);
  });
});

describe("notes", () => {
  it("stores the author's name", async () => {
    db.internalNote.create.mockResolvedValue({ id: "n1" });
    const { POST } = await import("@/app/api/tickets/[id]/notes/route");
    await POST(createRequest("/api/tickets/t1/notes", { method: "POST", body: { content: "called her" } }), ctx);
    expect(db.internalNote.create.mock.calls[0][0].data).toEqual({ conversationId: "c1", content: "called her", authorName: "Aisyah" });
  });
});
```

Check `tests/helpers/request.ts` for the exact `createRequest` signature and adapt the calls if needed. Keep the assertions.

Run: `npx vitest run tests/api/tickets.test.ts tests/api/ticket-detail.test.ts` — Expected: FAIL.

- [ ] **Step 3: List and create**

Replace `src/app/api/tickets/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { parsePagination, paginatedResponse } from "@/lib/pagination";
import { withAuth } from "@/lib/tenant/with-auth";
import { createTicketSchema, validateBody } from "@/lib/validations";
import { allowedProjectIds, projectWhere } from "@/lib/tickets/access";
import { OPEN_STATUSES, TICKET_STATUSES, isTicketStatus, type TicketStatus } from "@/lib/tickets/status";
import { createTicket } from "@/lib/tickets/service";

const ROW_INCLUDE = {
  project: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  conversation: { select: { customerName: true, customerContact: true, channel: true } },
} as const;

function statusFilter(value: string | null): Record<string, unknown> {
  if (!value || value === "all") return {};
  if (value === "open") return { status: { in: OPEN_STATUSES } };
  const list = value.split(",").filter(isTicketStatus);
  return list.length ? { status: { in: list } } : {};
}

export const GET = withAuth("tickets:read", async (request: NextRequest, auth) => {
  try {
    const params = request.nextUrl.searchParams;
    const { page, limit, skip, take } = parsePagination(params);
    const scope = projectWhere(await allowedProjectIds(auth));

    const filters: Record<string, unknown>[] = [scope];
    const projectId = params.get("projectId");
    if (projectId) filters.push({ projectId });
    const assignee = params.get("assignee");
    if (assignee === "me") filters.push({ assigneeId: auth.userId });
    else if (assignee === "unassigned") filters.push({ assigneeId: null });
    else if (assignee) filters.push({ assigneeId: assignee });
    const source = params.get("source");
    if (source) filters.push({ source });
    const q = params.get("q")?.trim();
    if (q) {
      const asNumber = Number(q.replace(/^#/, ""));
      filters.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { conversation: { customerName: { contains: q, mode: "insensitive" } } },
          ...(Number.isInteger(asNumber) && asNumber > 0 ? [{ number: asNumber }] : []),
        ],
      });
    }

    const where = { AND: [...filters, statusFilter(params.get("status"))] };
    const countWhere = { AND: filters };

    const [rows, total, grouped] = await Promise.all([
      prisma.ticket.findMany({ where, orderBy: { updatedAt: "desc" }, skip, take, include: ROW_INCLUDE }),
      prisma.ticket.count({ where }),
      prisma.ticket.groupBy({ by: ["status"], where: countWhere, _count: { _all: true } }),
    ]);

    const counts = Object.fromEntries(TICKET_STATUSES.map((s) => [s, 0])) as Record<TicketStatus, number>;
    for (const g of grouped as { status: string; _count: { _all: number } }[]) {
      if (isTicketStatus(g.status)) counts[g.status] = g._count._all;
    }

    return NextResponse.json({ ...paginatedResponse(rows, total, page, limit), counts });
  } catch (error) {
    logger.error("Failed to fetch tickets:", error);
    return NextResponse.json({ error: "Failed to fetch tickets" }, { status: 500 });
  }
});

export const POST = withAuth("tickets:create", async (request: NextRequest, auth) => {
  try {
    const validation = validateBody(createTicketSchema, await request.json());
    if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });

    const allowed = await allowedProjectIds(auth);
    const projectId = validation.data.projectId;
    if (allowed !== null) {
      if (!projectId) return NextResponse.json({ error: "Choose a project" }, { status: 400 });
      if (!allowed.includes(projectId)) return NextResponse.json({ error: "Not allowed for this project" }, { status: 403 });
    }

    const ticket = await createTicket(validation.data);
    return NextResponse.json(ticket, { status: 201 });
  } catch (error) {
    logger.error("Failed to create ticket:", error);
    return NextResponse.json({ error: "Failed to create ticket" }, { status: 500 });
  }
});
```

`validateBody` already exists in `src/lib/validations.ts`; check its return shape and match it.

- [ ] **Step 4: Detail, update, delete, replies, notes**

Create a shared loader in `src/lib/tickets/load.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { allowedProjectIds } from "./access";

// a ticket the user may see, or null. tickets in other projects look the same as missing ones.
export async function loadTicketFor(auth: { role: string; userId: string }, id: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) return null;
  const allowed = await allowedProjectIds(auth);
  if (allowed !== null && !allowed.includes(ticket.projectId)) return null;
  return ticket;
}
```

Replace `src/app/api/tickets/[id]/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { updateTicketSchema, validateBody } from "@/lib/validations";
import { allowedProjectIds } from "@/lib/tickets/access";
import { loadTicketFor } from "@/lib/tickets/load";
import { statusChange, InvalidTransitionError } from "@/lib/tickets/status";
import { STAFF_ROLES } from "@/lib/rbac";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => NextResponse.json({ error: "Ticket not found" }, { status: 404 });

export const GET = withAuth("tickets:read", async (_request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  if (!(await loadTicketFor(auth, id))) return notFound();
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      conversation: {
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          notes: { orderBy: { createdAt: "desc" } },
          customer: { select: { id: true, name: true, phone: true, email: true } },
        },
      },
    },
  });
  return NextResponse.json(ticket);
});

export const PATCH = withAuth("tickets:update", async (request: NextRequest, auth, { params }: Ctx) => {
  try {
    const { id } = await params;
    const ticket = await loadTicketFor(auth, id);
    if (!ticket) return notFound();

    const validation = validateBody(updateTicketSchema, await request.json());
    if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
    const { status, assigneeId, projectId, ...rest } = validation.data;

    const data: Record<string, unknown> = { ...rest };
    if (status) Object.assign(data, statusChange(ticket, status));

    if (assigneeId !== undefined) {
      if (assigneeId !== null) {
        const user = await prisma.admin.findUnique({ where: { id: assigneeId }, select: { role: true } });
        if (!user || !(STAFF_ROLES as readonly string[]).includes(user.role) || user.role === "viewer") {
          return NextResponse.json({ error: "Can't assign to that user" }, { status: 400 });
        }
      }
      data.assigneeId = assigneeId;
    }

    if (projectId !== undefined) {
      const allowed = await allowedProjectIds(auth);
      if (allowed !== null && !allowed.includes(projectId)) {
        return NextResponse.json({ error: "Not allowed for this project" }, { status: 403 });
      }
      data.projectId = projectId;
    }

    const updated = await prisma.ticket.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    logger.error("Failed to update ticket:", error);
    return NextResponse.json({ error: "Failed to update ticket" }, { status: 500 });
  }
});

export const DELETE = withAuth("tickets:delete", async (_request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  if (!(await loadTicketFor(auth, id))) return notFound();
  await prisma.ticket.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
```

Create `src/app/api/tickets/[id]/messages/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { ticketReplySchema, validateBody } from "@/lib/validations";
import { loadTicketFor } from "@/lib/tickets/load";
import { statusChange } from "@/lib/tickets/status";
import { emitNewMessage } from "@/lib/realtime";

type Ctx = { params: Promise<{ id: string }> };

// the reply is stored on the ticket. sending it to the client's channel is up to staff for now.
export const POST = withAuth("tickets:update", async (request: NextRequest, auth, { params }: Ctx) => {
  try {
    const { id } = await params;
    const ticket = await loadTicketFor(auth, id);
    if (!ticket || !ticket.conversationId) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    if (ticket.status === "closed") return NextResponse.json({ error: "Reopen the ticket first" }, { status: 409 });

    const validation = validateBody(ticketReplySchema, await request.json());
    if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
    const { content, markAnswered = true } = validation.data;

    const message = await prisma.message.create({
      data: { conversationId: ticket.conversationId, role: "agent", content },
    });

    const now = new Date();
    const data: Record<string, unknown> = markAnswered ? statusChange(ticket, "answered", now) : {};
    if (!ticket.firstReplyAt) data.firstReplyAt = now;
    if (!ticket.assigneeId) data.assigneeId = auth.userId.startsWith("api-key:") ? null : auth.userId;
    await prisma.ticket.update({ where: { id }, data });

    emitNewMessage(ticket.conversationId, { id: message.id, role: "agent", content });
    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    logger.error("Failed to add reply:", error);
    return NextResponse.json({ error: "Failed to add reply" }, { status: 500 });
  }
});
```

In the unit test the ticket mock has no `assigneeId`, so `data.assigneeId` becomes `"u1"`. That's fine; the test only checks `status` and `firstReplyAt`.

Create `src/app/api/tickets/[id]/notes/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { ticketNoteSchema, validateBody } from "@/lib/validations";
import { loadTicketFor } from "@/lib/tickets/load";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth("tickets:read", async (_request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const ticket = await loadTicketFor(auth, id);
  if (!ticket?.conversationId) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  const notes = await prisma.internalNote.findMany({
    where: { conversationId: ticket.conversationId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(notes);
});

export const POST = withAuth("tickets:update", async (request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const ticket = await loadTicketFor(auth, id);
  if (!ticket?.conversationId) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  const validation = validateBody(ticketNoteSchema, await request.json());
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
  const note = await prisma.internalNote.create({
    data: { conversationId: ticket.conversationId, content: validation.data.content, authorName: auth.name },
  });
  return NextResponse.json(note, { status: 201 });
});
```

- [ ] **Step 5: AI suggestion for quick add**

Create `src/app/api/tickets/suggest/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { getSettings } from "@/lib/settings";
import { chatConfig, isConfigured } from "@/lib/ai/config";
import { chatCompletion } from "@/lib/ai/provider";
import { titleFrom } from "@/lib/tickets/service";
import { logger } from "@/lib/logger";

// best effort: without AI, or on any error, fall back to the first line as the title
export const POST = withAuth("tickets:create", async (request: NextRequest) => {
  const body = (await request.json().catch(() => ({}))) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text.slice(0, 4000) : "";
  const fallback = { title: titleFrom(text), category: "" };
  if (!text.trim()) return NextResponse.json(fallback);

  try {
    const ai = chatConfig(await getSettings());
    if (!isConfigured(ai)) return NextResponse.json(fallback);
    const res = await chatCompletion(ai, {
      messages: [
        {
          role: "system",
          content:
            'You file support issues. Reply with JSON only: {"title": "<short title, max 70 chars, same language as the issue>", "category": "<one or two words>"}',
        },
        { role: "user", content: text },
      ],
      maxTokens: 120,
      temperature: 0,
    });
    const raw = res.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { title?: unknown; category?: unknown };
    return NextResponse.json({
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim().slice(0, 120) : fallback.title,
      category: typeof parsed.category === "string" ? parsed.category.trim().slice(0, 60) : "",
    });
  } catch (error) {
    logger.warn("Ticket suggestion failed, using the first line", error);
    return NextResponse.json(fallback);
  }
});
```

If `logger.warn` doesn't exist, use `logger.error`.

Run: `npx vitest run tests/api/tickets.test.ts tests/api/ticket-detail.test.ts tests/unit/route-guard.test.ts` — Expected: PASS.

- [ ] **Step 6: Old status words elsewhere**

Replace the old ticket status words in these files. Conversation statuses (`active`, `resolved`, `escalated`) stay as they are; only change places that read `ticket.status`.

| File | Change |
|---|---|
| `src/lib/conversation-engine.ts` | ticket filters `status: { in: ["open", "in_progress"] }` → `status: { in: OPEN_STATUSES }` (import from `@/lib/tickets/status`). Check lines near 112, 155 and 283; any ticket status *written* as `"in_progress"` → `"working"`, `"resolved"` → `"closed"` |
| `src/app/api/stats/route.ts` | `prisma.ticket.count({ where: { status: "open" } })` → `{ where: { status: { in: OPEN_STATUSES } } }` |
| `src/app/api/analytics/route.ts` | ticket `t.status === "resolved" \|\| t.status === "closed"` → `t.status === "closed"` |
| `src/app/(dashboard)/page.tsx` | ticket `status: "open"` → `status: { in: OPEN_STATUSES }`; ticket `status: "resolved"` → `status: "closed"` |
| `src/app/(dashboard)/api-docs/page.tsx`, `src/app/api/openapi.json/route.ts` | ticket examples and enums use the new statuses; conversation ones stay |

Run: `git grep -n '"in_progress"' -- src` — Expected: no output.

- [ ] **Step 7: Check and commit**

Run:
- `npx tsc --noEmit` — Expected: clean, with the old `@ts-expect-error` removed.
- `npx vitest run` — Expected: all pass.
- `npm run test:integration` — Expected: all pass.
- `npm run lint` — Expected: 0 errors.

```bash
git add src tests
git commit -m "ticket api: inbox list, detail, steps, replies, notes, quick add"
```

---

### Task 4: Channel messages become tickets

**Files:**
- Modify: `src/lib/ai/engine.ts`, `tests/unit/ai-engine.test.ts`
- Create: `tests/integration/incoming-messages.test.ts`

**Interfaces:**
- Consumes: `ticketForIncomingMessage` (Task 2), `maskIC`
- Produces: every call to `chat(conversationId, text)` saves the customer message with IC masked and attaches it to an open ticket (or opens one). This happens even when AI isn't configured.

- [ ] **Step 1: Integration test first**

Create `tests/integration/incoming-messages.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { chat } from "@/lib/ai/engine";

const A = "it-2a-in";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "A", slug: A } });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
});

describe("incoming channel messages", () => {
  it("become a ticket even without AI, with IC hidden", async () => {
    const reply = await runWithCompany(A, async () => {
      const conv = await prisma.conversation.create({ data: { channel: "whatsapp", customerName: "Ali" } });
      const answer = await chat(conv.id, "IC 900101145678 tak boleh semak");
      const tickets = await prisma.ticket.findMany({ where: { conversationId: conv.id } });
      const messages = await prisma.message.findMany({ where: { conversationId: conv.id } });
      expect(tickets).toHaveLength(1);
      expect(tickets[0].title).toBe("IC [IC HIDDEN] tak boleh semak");
      expect(messages[0].content).toBe("IC [IC HIDDEN] tak boleh semak");
      return answer;
    });
    expect(reply).toMatch(/AI is not configured/);
  });
});
```

The test company has no AI settings, so `chat` returns the "not configured" text. Run `npm run test:integration` — Expected: FAIL (no ticket is created, and no message is saved when AI isn't configured).

- [ ] **Step 2: Rework the start of `chat()`**

In `src/lib/ai/engine.ts`, `chat(conversationId, userMessage)`:

1. Remove the early block:

   ```ts
     if (!isConfigured(providerFor(config))) {
       return "AI is not configured. Please add your API key in Settings > AI Configuration.";
     }
   ```

2. Right after the `if (!conversation) { return "Conversation not found."; }` block, add:

   ```ts
     // every incoming message is kept on a ticket, with or without AI
     const customerText = maskIC(userMessage).text;
     await prisma.message.create({ data: { conversationId, role: "customer", content: customerText } });
     await ticketForIncomingMessage(conversationId, customerText);

     if (!isConfigured(providerFor(config))) {
       return "AI is not configured. Please add your API key in Settings > AI Configuration.";
     }
   ```

3. Delete the later `// Save user message` block (the second `prisma.message.create` with `role: "customer"`).
4. Change `messages.push({ role: "user", content: userMessage });` to `messages.push({ role: "user", content: customerText });`.
5. Imports: `maskIC` from `@/lib/privacy/ic-mask`, `ticketForIncomingMessage` from `@/lib/tickets/service`.

The history is still built from `conversation.messages`, which was read before the new message was saved, so the message isn't duplicated in the prompt.

- [ ] **Step 3: Unit tests follow**

`tests/unit/ai-engine.test.ts`:
- The "not configured" test now sees `message.create` called once. Update it.
- Add mocks so `ticketForIncomingMessage` works: `ticket.findFirst` resolves `{ id: "t1" }` and `ticket.update` resolves `{ id: "t1" }`.
- Tests that counted `message.create` calls or checked their order: the customer message is now saved first. Update the expected order, keeping each test's intent.

Run: `npx vitest run tests/unit/ai-engine.test.ts` and `npm run test:integration` — Expected: PASS.

- [ ] **Step 4: Check and commit**

Run:
- `npx tsc --noEmit` — Expected: clean.
- `npx vitest run` — Expected: all pass.
- `npm run smoke` — Expected: no runtime errors.

```bash
git add src tests
git commit -m "incoming messages land on a ticket, ic hidden"
```

---

### Task 5: Projects API and company info

**Files:**
- Create: `src/app/api/projects/route.ts`, `src/app/api/projects/[id]/route.ts`, `src/app/api/projects/[id]/access/route.ts`, `src/app/api/company/route.ts`, `tests/api/projects.test.ts`
- Modify: `src/lib/validations.ts` (project schemas and `projectLabel` in `updateSettingsSchema`), `src/app/(dashboard)/settings/page.tsx` (label choice in the General section)

**Interfaces:**
- Produces (HTTP):
  - `GET /api/projects?archived=1` → `{ data: { id, name, isDefault, archived, openTickets, people }[] }` (staff: only allowed projects)
  - `POST /api/projects` with `{ name }`
  - `PATCH /api/projects/:id` with `{ name?, archived? }` (the default project can't be archived)
  - `GET /api/projects/:id/access` → `{ adminIds: string[] }`
  - `PUT /api/projects/:id/access` with `{ adminIds: string[] }`
  - `GET /api/company` → `{ name, slug, projectLabel }` for any logged-in staff user

- [ ] **Step 1: Tests first**

Create `tests/api/projects.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest, parseJsonResponse } from "../helpers/request";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const asRole = (role: string) =>
  vi.mocked(requireAuth).mockResolvedValue({
    userId: "u1",
    role,
    username: "u",
    name: "U",
    authMethod: "cookie",
    companyId: "test-company",
  } as never);

beforeEach(() => {
  for (const m of ["project", "projectAccess", "ticket", "customer", "admin", "settings"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  asRole("admin");
});

describe("projects", () => {
  it("lists projects with open ticket and people counts", async () => {
    db.project.findMany.mockResolvedValue([{ id: "p1", name: "General", isDefault: true, archived: false }]);
    db.ticket.groupBy.mockResolvedValue([{ projectId: "p1", _count: { _all: 3 } }]);
    db.customer.groupBy.mockResolvedValue([{ projectId: "p1", _count: { _all: 2 } }]);
    const { GET } = await import("@/app/api/projects/route");
    const body = await parseJsonResponse(await GET(createRequest("/api/projects"), {} as never));
    expect(body.data[0]).toMatchObject({ id: "p1", openTickets: 3, people: 2 });
  });

  it("staff only see their projects", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    db.project.findMany.mockResolvedValue([]);
    db.ticket.groupBy.mockResolvedValue([]);
    db.customer.groupBy.mockResolvedValue([]);
    const { GET } = await import("@/app/api/projects/route");
    await GET(createRequest("/api/projects"), {} as never);
    expect(JSON.stringify(db.project.findMany.mock.calls[0][0].where)).toContain('"id":{"in":["p1"]}');
  });

  it("staff can't create projects", async () => {
    asRole("staff");
    const { POST } = await import("@/app/api/projects/route");
    const res = await POST(createRequest("/api/projects", { method: "POST", body: { name: "Alpha" } }), {} as never);
    expect(res.status).toBe(403);
  });

  it("a duplicate name is a 409", async () => {
    db.project.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const { POST } = await import("@/app/api/projects/route");
    const res = await POST(createRequest("/api/projects", { method: "POST", body: { name: "General" } }), {} as never);
    expect(res.status).toBe(409);
  });

  it("the default project can't be archived", async () => {
    db.project.findUnique.mockResolvedValue({ id: "p1", isDefault: true });
    const { PATCH } = await import("@/app/api/projects/[id]/route");
    const res = await PATCH(
      createRequest("/api/projects/p1", { method: "PATCH", body: { archived: true } }),
      { params: Promise.resolve({ id: "p1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("replaces the staff list of a project", async () => {
    db.project.findUnique.mockResolvedValue({ id: "p1" });
    db.admin.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
    const { PUT } = await import("@/app/api/projects/[id]/access/route");
    const res = await PUT(
      createRequest("/api/projects/p1/access", { method: "PUT", body: { adminIds: ["a1", "a2"] } }),
      { params: Promise.resolve({ id: "p1" }) }
    );
    expect(res.status).toBe(200);
    expect(db.projectAccess.deleteMany).toHaveBeenCalledWith({ where: { projectId: "p1" } });
    expect(db.projectAccess.createMany).toHaveBeenCalledWith({
      data: [
        { projectId: "p1", adminId: "a1" },
        { projectId: "p1", adminId: "a2" },
      ],
    });
  });
});

describe("company info", () => {
  it("returns the label for any staff user", async () => {
    asRole("viewer");
    db.settings.upsert.mockResolvedValue({ projectLabel: "Projects", businessName: "Acme" });
    db.company.findFirst.mockResolvedValue({ name: "Acme Sdn Bhd", slug: "acme" });
    const { GET } = await import("@/app/api/company/route");
    const body = await parseJsonResponse(await GET(createRequest("/api/company"), {} as never));
    expect(body).toEqual({ name: "Acme Sdn Bhd", slug: "acme", projectLabel: "Projects" });
  });
});
```

Run it — Expected: FAIL.

- [ ] **Step 2: Validation**

Add to `src/lib/validations.ts`:

```ts
export const projectSchema = z.object({ name: z.string().trim().min(1, "Name is required").max(120) });
export const updateProjectSchema = z
  .object({ name: z.string().trim().min(1).max(120).optional(), archived: z.boolean().optional() })
  .strict();
export const projectAccessSchema = z.object({ adminIds: z.array(z.string().max(100)).max(500) });
```

In `updateSettingsSchema`, add `projectLabel: z.enum(["Clients", "Projects"]).optional(),`.

- [ ] **Step 3: Routes**

Create `src/app/api/projects/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { projectSchema, validateBody } from "@/lib/validations";
import { allowedProjectIds } from "@/lib/tickets/access";
import { OPEN_STATUSES } from "@/lib/tickets/status";

export const GET = withAuth("projects:read", async (request: NextRequest, auth) => {
  const allowed = await allowedProjectIds(auth);
  const showArchived = request.nextUrl.searchParams.get("archived") === "1";
  const where = {
    ...(allowed === null ? {} : { id: { in: allowed } }),
    ...(showArchived ? {} : { archived: false }),
  };
  const projects = await prisma.project.findMany({ where, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  const ids = projects.map((p) => p.id);
  const [tickets, people] = await Promise.all([
    prisma.ticket.groupBy({
      by: ["projectId"],
      where: { projectId: { in: ids }, status: { in: OPEN_STATUSES } },
      _count: { _all: true },
    }),
    prisma.customer.groupBy({ by: ["projectId"], where: { projectId: { in: ids } }, _count: { _all: true } }),
  ]);
  const count = (rows: { projectId: string | null; _count: { _all: number } }[], id: string) =>
    rows.find((r) => r.projectId === id)?._count._all ?? 0;
  return NextResponse.json({
    data: projects.map((p) => ({
      ...p,
      openTickets: count(tickets as never, p.id),
      people: count(people as never, p.id),
    })),
  });
});

export const POST = withAuth("projects:manage", async (request: NextRequest) => {
  const validation = validateBody(projectSchema, await request.json());
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
  try {
    const project = await prisma.project.create({ data: { name: validation.data.name } });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A project with that name already exists" }, { status: 409 });
    }
    logger.error("Failed to create project:", error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
});
```

Create `src/app/api/projects/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { updateProjectSchema, validateBody } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = withAuth("projects:manage", async (request: NextRequest, _auth, { params }: Ctx) => {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const validation = validateBody(updateProjectSchema, await request.json());
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
  if (validation.data.archived && project.isDefault) {
    return NextResponse.json({ error: "The default project can't be archived" }, { status: 400 });
  }
  try {
    return NextResponse.json(await prisma.project.update({ where: { id }, data: validation.data }));
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A project with that name already exists" }, { status: 409 });
    }
    throw error;
  }
});
```

Create `src/app/api/projects/[id]/access/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { projectAccessSchema, validateBody } from "@/lib/validations";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth("projects:manage", async (_request: NextRequest, _auth, { params }: Ctx) => {
  const { id } = await params;
  const rows = await prisma.projectAccess.findMany({ where: { projectId: id }, select: { adminId: true } });
  return NextResponse.json({ adminIds: rows.map((r) => r.adminId) });
});

export const PUT = withAuth("projects:manage", async (request: NextRequest, _auth, { params }: Ctx) => {
  const { id } = await params;
  if (!(await prisma.project.findUnique({ where: { id } }))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  const validation = validateBody(projectAccessSchema, await request.json());
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });

  // only staff accounts of this company; the scoped client drops anything else
  const users = await prisma.admin.findMany({
    where: { id: { in: validation.data.adminIds }, role: { in: ["staff", "viewer"] } },
    select: { id: true },
  });
  await prisma.projectAccess.deleteMany({ where: { projectId: id } });
  if (users.length) {
    await prisma.projectAccess.createMany({ data: users.map((u) => ({ projectId: id, adminId: u.id })) });
  }
  return NextResponse.json({ adminIds: users.map((u) => u.id) });
});
```

Create `src/app/api/company/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { currentCompanyId } from "@/lib/tenant/context";

// small, non-secret details every staff screen needs (settings itself is admin-only)
export const GET = withAuth(undefined, async (_request: NextRequest) => {
  const [company, settings] = await Promise.all([
    prisma.company.findFirst({ select: { name: true, slug: true } }),
    prisma.settings.upsert({ where: { companyId: currentCompanyId() }, update: {}, create: {} }),
  ]);
  return NextResponse.json({
    name: company?.name ?? "",
    slug: company?.slug ?? "",
    projectLabel: settings.projectLabel,
  });
});
```

The scoped client limits `company.findFirst` to the current company (stage 1B).

- [ ] **Step 4: Label in Settings**

`src/app/(dashboard)/settings/page.tsx`:
- Add `projectLabel: string` to `SettingsData`, default `"Clients"`.
- Add it to `sectionFields.general`.
- In the General section, add:

```tsx
      <FormField label="Call client groups" description="What your team calls the groups tickets belong to.">
        <SelectInput
          value={data.projectLabel}
          onChange={(v) => update("projectLabel", v)}
          options={[
            { value: "Clients", label: "Clients" },
            { value: "Projects", label: "Projects" },
          ]}
        />
      </FormField>
```

Run: `npx vitest run tests/api/projects.test.ts tests/unit/route-guard.test.ts` — Expected: PASS.

- [ ] **Step 5: Check and commit**

Run:
- `npx tsc --noEmit` — Expected: clean.
- `npx vitest run` — Expected: all pass.
- `npm run test:integration` — Expected: all pass.

```bash
git add src tests
git commit -m "projects api, staff access per project, client label"
```

---

### Task 6: Ticket inbox and detail screens

**Files:**
- Create:
  - `src/components/tickets/status-dot.tsx`, `src/components/tickets/quick-add-dialog.tsx`, `src/components/tickets/ticket-list.tsx`
  - `src/app/(dashboard)/tickets/[id]/page.tsx`
  - `src/lib/hooks/use-company.ts`
  - `tests/unit/ticket-ui-helpers.test.ts`
- Rewrite: `src/app/(dashboard)/tickets/page.tsx`
- Modify:
  - `src/app/(dashboard)/conversations/page.tsx` (redirect)
  - `src/components/layout/nav-items.ts`, `tests/unit/nav-items.test.ts`
  - `scripts/smoke-pages.mjs`

**Interfaces:**
- Consumes: the Task 3 API, `STATUS_LABELS` and `TicketStatus` (Task 2), `unwrapList`/`listMeta`, `Header`, `cn`, `formatRelativeTime`
- Produces:
  - `useCompany(): { name: string; slug: string; projectLabel: string }`
  - `/tickets` and `/tickets/[id]` pages
  - `statusTone(status): string` and `sourceLabel(source): string` in `status-dot.tsx`

- [ ] **Step 1: Small helpers, test first**

Create `tests/unit/ticket-ui-helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { statusTone, sourceLabel } from "@/components/tickets/status-dot";

describe("ticket ui helpers", () => {
  it("gives every status a dot colour", () => {
    for (const s of ["new", "ai_suggested", "answered", "reopened", "working", "closed"]) {
      expect(statusTone(s)).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("names the sources", () => {
    expect(sourceLabel("whatsapp")).toBe("WhatsApp");
    expect(sourceLabel("quick_add")).toBe("Quick add");
    expect(sourceLabel("something_new")).toBe("Something new");
  });
});
```

Create `src/components/tickets/status-dot.tsx`:

```tsx
import { STATUS_LABELS, isTicketStatus } from "@/lib/tickets/status";

const TONES: Record<string, string> = {
  new: "#3B82F6",
  ai_suggested: "#7A5AF8",
  answered: "#EAAA08",
  reopened: "#D92D20",
  working: "#F79009",
  closed: "#12B76A",
};

const SOURCES: Record<string, string> = {
  whatsapp: "WhatsApp",
  whatsapp_group: "WhatsApp group",
  staff_whatsapp: "Staff WhatsApp",
  web_form: "Web form",
  email: "Email",
  sms: "SMS",
  phone: "Phone",
  telegram: "Telegram",
  old_system: "Old system",
  quick_add: "Quick add",
  ai: "AI",
  api: "API",
};

export function statusTone(status: string): string {
  return TONES[status] ?? "#98A2B3";
}

export function sourceLabel(source: string): string {
  if (SOURCES[source]) return SOURCES[source];
  const words = source.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function StatusDot({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-helplus-text whitespace-nowrap">
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: statusTone(status) }} />
      {isTicketStatus(status) ? STATUS_LABELS[status] : status}
    </span>
  );
}
```

Run it — Expected: PASS.

- [ ] **Step 2: Company hook**

Create `src/lib/hooks/use-company.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

interface CompanyInfo {
  name: string;
  slug: string;
  projectLabel: string;
}

const EMPTY: CompanyInfo = { name: "", slug: "", projectLabel: "Clients" };
let cached: CompanyInfo | null = null;

export function useCompany(): CompanyInfo {
  const [info, setInfo] = useState<CompanyInfo>(cached ?? EMPTY);
  useEffect(() => {
    if (cached) return;
    fetch("/api/company")
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((d: CompanyInfo) => {
        cached = d;
        setInfo(d);
      })
      .catch(() => setInfo(EMPTY));
  }, []);
  return info;
}
```

- [ ] **Step 3: Quick add dialog**

Create `src/components/tickets/quick-add-dialog.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { unwrapList } from "@/lib/api-client";

interface Project {
  id: string;
  name: string;
  isDefault: boolean;
}

export function QuickAddDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list = unwrapList<Project>(d);
        setProjects(list);
        setProjectId((cur) => cur || list.find((p) => p.isDefault)?.id || list[0]?.id || "");
      })
      .catch(() => setProjects([]));
  }, [open]);

  if (!open) return null;

  const suggest = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const res = await fetch("/api/tickets/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const d = await res.json().catch(() => ({}));
    if (d.title) setTitle(d.title);
    if (d.category) setCategory(d.category);
    setBusy(false);
  };

  const submit = async () => {
    setError("");
    if (!text.trim()) {
      setError("Paste or type the issue first.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        title: title || undefined,
        category: category || undefined,
        customerName: customerName || undefined,
        projectId: projectId || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(typeof d.error === "string" ? d.error : "Couldn't create the ticket.");
      return;
    }
    const ticket = await res.json();
    setText("");
    setTitle("");
    setCategory("");
    setCustomerName("");
    onCreated(ticket.id);
  };

  const field =
    "w-full rounded-md border border-helplus-border bg-helplus-surface px-3 py-2 text-sm text-helplus-text focus:outline-none focus:ring-2 focus:ring-helplus-primary/30";

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full md:max-w-xl rounded-t-xl md:rounded-lg bg-helplus-surface border border-helplus-border p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-helplus-text">Quick add</h3>
          <button onClick={onClose} aria-label="Close" className="p-1 text-helplus-text-light">
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className="block text-xs text-helplus-text-light">Paste the message</label>
        <textarea
          className={field}
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the WhatsApp message here. IC numbers are hidden automatically."
        />
        <div className="flex justify-end">
          <button
            onClick={suggest}
            disabled={busy || !text.trim()}
            className="inline-flex items-center gap-1.5 text-sm text-helplus-link disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" /> Suggest title and category
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className={field} placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className={field} placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input className={field} placeholder="Client name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          <select className={field} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-helplus-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="h-10 px-4 rounded-md border border-helplus-border text-sm text-helplus-text">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="h-10 px-4 rounded-md bg-helplus-primary text-white text-sm font-medium disabled:opacity-60"
          >
            Create ticket
          </button>
        </div>
      </div>
    </div>
  );
}
```

`Sparkles` is a lucide icon, not an emoji, which is allowed.

- [ ] **Step 4: List component and inbox page**

Create `src/components/tickets/ticket-list.tsx`:

```tsx
"use client";

import Link from "next/link";
import { formatRelativeTime } from "@/lib/utils";
import { StatusDot, sourceLabel } from "./status-dot";

export interface TicketRow {
  id: string;
  number: number;
  title: string;
  status: string;
  source: string;
  category: string;
  aiMatch: number | null;
  updatedAt: string;
  project: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  conversation: { customerName: string; customerContact: string } | null;
}

export function TicketList({ rows }: { rows: TicketRow[] }) {
  if (!rows.length) {
    return <div className="rounded-md border border-helplus-border bg-helplus-surface p-6 text-sm text-helplus-text-light">Nothing in this view.</div>;
  }
  return (
    <>
      <div className="hidden md:block rounded-md border border-helplus-border bg-helplus-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-helplus-text-light border-b border-helplus-border">
              <th className="px-3 py-2 font-medium">ID</th>
              <th className="px-3 py-2 font-medium">Issue</th>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Handled by</th>
              <th className="px-3 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-helplus-border last:border-0 hover:bg-helplus-primary-50">
                <td className="px-3 py-3 font-mono text-xs text-helplus-text-light">
                  <Link href={`/tickets/${t.id}`}>#{t.number}</Link>
                </td>
                <td className="px-3 py-3">
                  <Link href={`/tickets/${t.id}`} className="font-medium text-helplus-text">
                    {t.title}
                  </Link>
                  <div className="text-xs text-helplus-text-light">
                    {t.project.name}
                    {t.category ? ` · ${t.category}` : ""}
                    {t.aiMatch ? ` · AI match ${t.aiMatch}%` : ""}
                  </div>
                </td>
                <td className="px-3 py-3 text-helplus-text">{t.conversation?.customerName ?? "Unknown"}</td>
                <td className="px-3 py-3 text-xs text-helplus-text-light">{sourceLabel(t.source)}</td>
                <td className="px-3 py-3">
                  <StatusDot status={t.status} />
                </td>
                <td className="px-3 py-3 text-xs text-helplus-text">{t.assignee?.name ?? <span className="text-helplus-text-light">Unassigned</span>}</td>
                <td className="px-3 py-3 text-xs text-helplus-text-light">{formatRelativeTime(t.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden space-y-2">
        {rows.map((t) => (
          <Link key={t.id} href={`/tickets/${t.id}`} className="block rounded-md border border-helplus-border bg-helplus-surface p-3">
            <div className="flex justify-between text-xs text-helplus-text-light">
              <span>
                <span className="font-mono">#{t.number}</span> · {sourceLabel(t.source)}
              </span>
              <span>{formatRelativeTime(t.updatedAt)}</span>
            </div>
            <div className="mt-1 mb-2 text-sm font-medium text-helplus-text">{t.title}</div>
            <div className="flex items-center gap-2">
              <StatusDot status={t.status} />
              <span className="text-xs text-helplus-text-light">
                {t.conversation?.customerName ?? "Unknown"} · {t.assignee?.name ?? "Unassigned"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
```

Replace `src/app/(dashboard)/tickets/page.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Header } from "@/components/layout/header";
import { cn } from "@/lib/utils";
import { unwrapList, listMeta } from "@/lib/api-client";
import { TicketList, type TicketRow } from "@/components/tickets/ticket-list";
import { QuickAddDialog } from "@/components/tickets/quick-add-dialog";
import { STATUS_LABELS, type TicketStatus } from "@/lib/tickets/status";

const CHIPS: { key: string; label: string; status: string; assignee?: string }[] = [
  { key: "open", label: "Open", status: "open" },
  { key: "mine", label: "Mine", status: "open", assignee: "me" },
  { key: "unassigned", label: "Unassigned", status: "open", assignee: "unassigned" },
  { key: "ai", label: STATUS_LABELS.ai_suggested, status: "ai_suggested" },
  { key: "reopened", label: STATUS_LABELS.reopened, status: "reopened" },
  { key: "closed", label: STATUS_LABELS.closed, status: "closed" },
  { key: "all", label: "All", status: "all" },
];

export default function TicketsPage() {
  const router = useRouter();
  const [chip, setChip] = useState("open");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [counts, setCounts] = useState<Partial<Record<TicketStatus, number>>>({});
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const c = CHIPS.find((x) => x.key === chip)!;
    const params = new URLSearchParams({ status: c.status, page: String(page), limit: "25" });
    if (c.assignee) params.set("assignee", c.assignee);
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/tickets?${params}`);
    if (res.ok) {
      const json = await res.json();
      setRows(unwrapList<TicketRow>(json));
      setPages(listMeta(json)?.totalPages || 1);
      setCounts(json.counts ?? {});
    }
    setLoading(false);
  }, [chip, q, page]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const openCount = (["new", "ai_suggested", "answered", "reopened", "working"] as TicketStatus[]).reduce(
    (n, s) => n + (counts[s] ?? 0),
    0
  );
  const chipCount = (key: string) =>
    key === "open" ? openCount : key === "ai" ? counts.ai_suggested : key === "reopened" ? counts.reopened : key === "closed" ? counts.closed : undefined;

  return (
    <>
      <Header
        title="Tickets"
        description="Every issue from WhatsApp, the web form and imports"
        actions={
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" /> Quick add
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search ticket #, title, client…"
            className="flex-1 min-w-[180px] max-w-sm h-9 rounded-md border border-helplus-border bg-helplus-surface px-3 text-sm text-helplus-text"
          />
          {CHIPS.map((c) => (
            <button
              key={c.key}
              onClick={() => {
                setChip(c.key);
                setPage(1);
              }}
              className={cn(
                "h-8 px-3 rounded-md border text-xs inline-flex items-center gap-1.5",
                chip === c.key
                  ? "bg-helplus-text border-helplus-text text-helplus-bg"
                  : "border-helplus-border bg-helplus-surface text-helplus-text"
              )}
            >
              {c.label}
              {chipCount(c.key) !== undefined && <span className="font-mono">{chipCount(c.key)}</span>}
            </button>
          ))}
        </div>
        {loading ? <div className="text-sm text-helplus-text-light">Loading…</div> : <TicketList rows={rows} />}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm text-helplus-text">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-8 px-3 rounded-md border border-helplus-border disabled:opacity-40">
              Previous
            </button>
            <span className="text-helplus-text-light">
              {page} / {pages}
            </span>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="h-8 px-3 rounded-md border border-helplus-border disabled:opacity-40">
              Next
            </button>
          </div>
        )}
      </div>
      <QuickAddDialog open={adding} onClose={() => setAdding(false)} onCreated={(id) => router.push(`/tickets/${id}`)} />
    </>
  );
}
```

The selected chip uses `text-helplus-bg` on a `bg-helplus-text` background. If the contrast guard test rejects the `bg` token as a text colour, use `text-white` in light mode instead. Check `tests/unit/theme-contrast.test.ts` and follow what it allows; don't edit the test.

- [ ] **Step 5: Ticket detail page**

Create `src/app/(dashboard)/tickets/[id]/page.tsx`:

```tsx
"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Header } from "@/components/layout/header";
import { formatRelativeTime } from "@/lib/utils";
import { unwrapList } from "@/lib/api-client";
import { StatusDot, sourceLabel } from "@/components/tickets/status-dot";
import { STATUS_LABELS, TICKET_STATUSES } from "@/lib/tickets/status";

interface Msg {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}
interface Note {
  id: string;
  content: string;
  authorName: string;
  createdAt: string;
}
interface Ticket {
  id: string;
  number: number;
  title: string;
  status: string;
  source: string;
  category: string;
  priority: string;
  createdAt: string;
  project: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  conversation: { customerName: string; customerContact: string; messages: Msg[]; notes: Note[] } | null;
}
interface Person {
  id: string;
  name: string;
  role: string;
}

const WHO: Record<string, string> = { customer: "Client", agent: "Support", assistant: "AI", system: "System" };

export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [missing, setMissing] = useState(false);
  const [staff, setStaff] = useState<Person[]>([]);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/tickets/${id}`);
    if (!res.ok) {
      setMissing(true);
      return;
    }
    setTicket(await res.json());
  }, [id]);

  useEffect(() => {
    load();
    fetch("/api/admin/users?limit=100")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setStaff(unwrapList<Person>(d).filter((p) => p.role !== "viewer" && p.role !== "client")))
      .catch(() => setStaff([]));
  }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    setError("");
    const res = await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't save");
    await load();
  };

  const send = async (markAnswered: boolean) => {
    if (!reply.trim()) return;
    setError("");
    const res = await fetch(`/api/tickets/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: reply, markAnswered }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Couldn't send");
      return;
    }
    if (markAnswered) await navigator.clipboard?.writeText(reply).catch(() => undefined);
    setReply("");
    await load();
  };

  const addNote = async () => {
    if (!note.trim()) return;
    await fetch(`/api/tickets/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: note }),
    });
    setNote("");
    await load();
  };

  if (missing) {
    return (
      <>
        <Header title="Ticket not found" />
        <div className="p-6 text-sm text-helplus-text-light">
          It doesn't exist, or it's in a project you can't see. <Link href="/tickets" className="text-helplus-link">Back to tickets</Link>
        </div>
      </>
    );
  }
  if (!ticket) return <div className="p-6 text-sm text-helplus-text-light">Loading…</div>;

  const box = "w-full rounded-md border border-helplus-border bg-helplus-surface px-3 py-2 text-sm text-helplus-text";

  return (
    <>
      <Header
        title={`#${ticket.number} ${ticket.title}`}
        description={`${sourceLabel(ticket.source)} · ${ticket.project.name}`}
        actions={
          <Link href="/tickets" className="inline-flex items-center gap-1 h-9 px-3 rounded-md border border-helplus-border text-sm text-helplus-text">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
          <div className="space-y-4">
            {ticket.conversation?.messages.map((m) => (
              <div key={m.id} className="flex gap-3">
                <div className="h-7 w-7 shrink-0 rounded-full bg-helplus-primary-50 text-helplus-link text-[11px] font-semibold grid place-items-center">
                  {(WHO[m.role] ?? m.role).slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="text-xs text-helplus-text-light">
                    <span className="font-semibold text-helplus-text">{m.role === "customer" ? ticket.conversation?.customerName : WHO[m.role] ?? m.role}</span>{" "}
                    · {formatRelativeTime(m.createdAt)}
                  </div>
                  <div className="text-sm text-helplus-text whitespace-pre-wrap">{m.content}</div>
                </div>
              </div>
            ))}
            {ticket.status !== "closed" && (
              <div className="space-y-2">
                <textarea className={box} rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write the reply you'll send to the client…" />
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => send(true)} className="h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium">
                    Copy and mark answered
                  </button>
                  <button onClick={() => send(false)} className="h-9 px-3 rounded-md border border-helplus-border text-sm text-helplus-text">
                    Save reply only
                  </button>
                </div>
              </div>
            )}
            {error && <p className="text-sm text-helplus-danger">{error}</p>}
          </div>

          <div className="space-y-4">
            <div className="rounded-md border border-helplus-border bg-helplus-surface p-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs text-helplus-text-light">Status</span>
                <StatusDot status={ticket.status} />
              </div>
              <select className={box} value="" onChange={(e) => e.target.value && patch({ status: e.target.value })}>
                <option value="">Move to…</option>
                {TICKET_STATUSES.filter((s) => s !== ticket.status).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <label className="block text-xs text-helplus-text-light">Handled by</label>
              <select className={box} value={ticket.assignee?.id ?? ""} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
                <option value="">Unassigned</option>
                {staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="flex justify-between">
                <span className="text-xs text-helplus-text-light">Client</span>
                <span className="text-helplus-text">{ticket.conversation?.customerName ?? "Unknown"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-helplus-text-light">Opened</span>
                <span className="text-helplus-text">{formatRelativeTime(ticket.createdAt)}</span>
              </div>
            </div>
            <div className="rounded-md border border-helplus-border bg-helplus-surface p-4 space-y-2">
              <h3 className="text-sm font-semibold text-helplus-text">Internal notes</h3>
              <textarea className={box} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only staff see this" />
              <button onClick={addNote} className="h-8 px-3 rounded-md border border-helplus-border text-xs text-helplus-text">
                Add note
              </button>
              {ticket.conversation?.notes.map((n) => (
                <div key={n.id} className="text-xs border-t border-helplus-border pt-2">
                  <div className="text-helplus-text whitespace-pre-wrap">{n.content}</div>
                  <div className="text-helplus-text-light">
                    {n.authorName} · {formatRelativeTime(n.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
```

`/api/admin/users` needs `admin:read`, so staff get a 403 and the "Handled by" list stays empty. That's acceptable for now: staff can still take a ticket by replying, because the reply assigns it to them. Only admins pick another person.

- [ ] **Step 6: Navigation and the old Conversations page**

Replace `src/app/(dashboard)/conversations/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

// conversations live inside tickets now
export default function ConversationsPage() {
  redirect("/tickets");
}
```

`src/components/layout/nav-items.ts`:
- Remove the `Inbox` item from `mainNav`, and remove the `MessagesSquare` import if it's now unused.
- Change `Clients` to `href: "/projects"`.
- Add a section group:

```ts
  {
    name: "Clients",
    items: [
      { name: "Projects", href: "/projects" },
      { name: "People", href: "/customers" },
    ],
  },
```

- Give `Clients` in `mainNav` `match: hrefsOf("Clients")`. Put the new group before `Settings` in `sectionGroups`, because `hrefsOf` reads `sectionGroups`.

`tests/unit/nav-items.test.ts`:
- Expected phone tabs become `["Dashboard", "Tickets", "Clients", "Library"]`.
- `moreActive("/channels")` is still true, and `moreActive("/tickets")` is still false.
- Add `expect(groupFor("/customers")?.name).toBe("Clients")`.

`scripts/smoke-pages.mjs`: add `"/projects"` to `PAGES`. `/conversations` now redirects, which is fine.

Run: `npx vitest run tests/unit/nav-items.test.ts tests/unit/ticket-ui-helpers.test.ts tests/unit/theme-contrast.test.ts` — Expected: PASS.

- [ ] **Step 7: Check and commit**

Run:
- `npx tsc --noEmit` — Expected: clean.
- `npx vitest run` — Expected: all pass.
- `npm run lint` — Expected: 0 errors.

Visit `/projects` only after Task 7; until then, skip it in smoke with `SMOKE_EXTRA` unset, or leave it out of `PAGES` until Task 7.

Run: `npm run smoke` — Expected: no runtime errors.

Manual, with a headless screenshot saved under `.superpowers/` (not committed):
- `/tickets` on desktop (1280) and phone (390) shows the chips and rows.
- Quick add creates a ticket and opens it.
- On the detail page, replying with "Copy and mark answered" moves the status to Answered.

```bash
git add src tests scripts
git commit -m "ticket inbox, detail page and quick add"
```

---

### Task 7: Clients/projects screens

**Files:**
- Create: `src/app/(dashboard)/projects/page.tsx`, `src/app/(dashboard)/projects/[id]/page.tsx`
- Modify: `scripts/smoke-pages.mjs` (make sure `/projects` is in `PAGES`)

**Interfaces:**
- Consumes: the Task 5 API, `useCompany`, `Header`, `unwrapList`
- Produces: `/projects` (list, create, archive) and `/projects/[id]` (open tickets link, staff access for admins)

- [ ] **Step 1: Projects list**

Create `src/app/(dashboard)/projects/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { unwrapList } from "@/lib/api-client";
import { useCompany } from "@/lib/hooks/use-company";

interface Project {
  id: string;
  name: string;
  isDefault: boolean;
  archived: boolean;
  openTickets: number;
  people: number;
}

export default function ProjectsPage() {
  const { projectLabel } = useCompany();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [canManage, setCanManage] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(unwrapList<Project>(await res.json()));
  }, []);

  useEffect(() => {
    load();
    fetch("/api/projects/_/access").then((r) => setCanManage(r.status !== 403)).catch(() => setCanManage(false));
  }, [load]);

  const create = async () => {
    setError("");
    if (!name.trim()) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Couldn't create");
      return;
    }
    setName("");
    await load();
  };

  const singular = projectLabel === "Projects" ? "project" : "client";

  return (
    <>
      <Header title={projectLabel} description={`Tickets and people are grouped by ${singular}`} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`New ${singular} name`}
              className="flex-1 min-w-[200px] max-w-sm h-9 rounded-md border border-helplus-border bg-helplus-surface px-3 text-sm text-helplus-text"
            />
            <button onClick={create} className="h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium">
              Add {singular}
            </button>
            {error && <p className="w-full text-sm text-helplus-danger">{error}</p>}
          </div>
        )}
        <div className="rounded-md border border-helplus-border bg-helplus-surface divide-y divide-helplus-border">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-helplus-primary-50">
              <div>
                <div className="text-sm font-medium text-helplus-text">
                  {p.name} {p.isDefault && <span className="text-xs text-helplus-text-light">(default)</span>}
                </div>
                <div className="text-xs text-helplus-text-light">{p.people} people</div>
              </div>
              <div className="text-sm text-helplus-text">
                <span className="font-mono">{p.openTickets}</span> <span className="text-xs text-helplus-text-light">open</span>
              </div>
            </Link>
          ))}
          {!projects.length && <div className="p-4 text-sm text-helplus-text-light">No {projectLabel.toLowerCase()} yet.</div>}
        </div>
      </div>
    </>
  );
}
```

`/api/projects/_/access` is used to probe permission: `withAuth` returns 403 for staff before the route body runs, and admins get a 200 with an empty list. If the probe feels hacky in review, you may replace it with a `canManage` flag from `/api/company`. If you do, add `canManageProjects: hasPermission(auth.role, "projects:manage")` there and update its test.

- [ ] **Step 2: Project detail with staff access**

Create `src/app/(dashboard)/projects/[id]/page.tsx`:

```tsx
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Header } from "@/components/layout/header";
import { unwrapList } from "@/lib/api-client";

interface Project {
  id: string;
  name: string;
  isDefault: boolean;
  archived: boolean;
  openTickets: number;
}
interface Person {
  id: string;
  name: string;
  role: string;
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [staff, setStaff] = useState<Person[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    fetch("/api/projects?archived=1")
      .then((r) => r.json())
      .then((d) => setProject(unwrapList<Project>(d).find((p) => p.id === id) ?? null));
    fetch(`/api/projects/${id}/access`).then(async (r) => {
      if (r.status === 403) return;
      setCanManage(true);
      setSelected((await r.json()).adminIds ?? []);
      const users = await fetch("/api/admin/users?limit=100").then((u) => (u.ok ? u.json() : []));
      setStaff(unwrapList<Person>(users).filter((p) => p.role === "staff" || p.role === "viewer"));
    });
  }, [id]);

  const toggle = (adminId: string) =>
    setSelected((cur) => (cur.includes(adminId) ? cur.filter((x) => x !== adminId) : [...cur, adminId]));

  const save = async () => {
    const res = await fetch(`/api/projects/${id}/access`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminIds: selected }),
    });
    setSaved(res.ok ? "Saved" : "Couldn't save");
  };

  const archive = async () => {
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: !project?.archived }),
    });
    setProject((p) => (p ? { ...p, archived: !p.archived } : p));
  };

  if (!project) return <div className="p-6 text-sm text-helplus-text-light">Loading…</div>;

  return (
    <>
      <Header
        title={project.name}
        description={`${project.openTickets} open tickets${project.archived ? " · archived" : ""}`}
        actions={
          <Link href="/projects" className="inline-flex items-center gap-1 h-9 px-3 rounded-md border border-helplus-border text-sm text-helplus-text">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 max-w-2xl">
        <Link href={`/tickets?projectId=${project.id}`} className="text-sm text-helplus-link">
          See this project's tickets
        </Link>
        {canManage && (
          <div className="rounded-md border border-helplus-border bg-helplus-surface p-4 space-y-3">
            <h3 className="text-sm font-semibold text-helplus-text">Staff who can see it</h3>
            <p className="text-xs text-helplus-text-light">Owners, admins and supervisors always see every project.</p>
            {staff.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm text-helplus-text min-h-[36px]">
                <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                {p.name} <span className="text-xs text-helplus-text-light">{p.role}</span>
              </label>
            ))}
            {!staff.length && <p className="text-sm text-helplus-text-light">No staff or viewer accounts yet.</p>}
            <div className="flex items-center gap-3">
              <button onClick={save} className="h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium">
                Save access
              </button>
              {saved && <span className="text-xs text-helplus-text-light">{saved}</span>}
            </div>
            {!project.isDefault && (
              <button onClick={archive} className="h-9 px-3 rounded-md border border-helplus-border text-sm text-helplus-text">
                {project.archived ? "Unarchive" : "Archive"}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
```

The link `/tickets?projectId=` needs the tickets page to read `projectId` from the URL. In `tickets/page.tsx`:
- Read it with `useSearchParams()` from `next/navigation`.
- Pass it to the API as `projectId`.
- Show a "Project: <name> ×" chip that clears it.

Wrap the page in `<Suspense>` if Next asks for it.

- [ ] **Step 3: Check and commit**

Run:
- `npx tsc --noEmit` — Expected: clean.
- `npx vitest run` — Expected: all pass.
- `npm run test:integration` — Expected: all pass.
- `npm run lint` — Expected: 0 errors.
- `npm run smoke` — Expected: no runtime errors, including `/projects`.
- `npx next build` — stop the dev server first and restart it afterwards. Expected: build succeeds.

Manual, with screenshots under `.superpowers/`:
- `/projects` lists General with its open count.
- As admin, add a project "Alpha", open it, tick a staff account and save.
- Log in as that staff account; `/tickets` shows only tickets from Alpha and General if ticked. To create the account, use the admin users screen.

```bash
git add src scripts
git commit -m "clients and projects screens with staff access"
```

---

## Done when

- `npx vitest run`, `npm run test:integration`, `npx tsc --noEmit`, `npm run lint`, `npm run smoke` and `npx next build` all pass.
- Every ticket has a per-company number, a project and one of the six statuses. Old tickets and conversations were migrated: nothing lost, numbers are unique, statuses are mapped.
- Status changes follow the step rules (409 on a skipped step) and stamp `firstReplyAt`, `answeredAt`, `closedAt` and `reopenCount`.
- Staff and viewers only see tickets of projects they're given; owners, admins and supervisors see all.
- Messages arriving through any channel land on a ticket with IC hidden, even without AI.
- Staff can quick add, reply ("Copy and mark answered"), add internal notes, change status and handler, on desktop and phone.
- Clients/projects screens exist, and the label (Clients or Projects) is chosen in Settings.

Not in this plan (stage 2B):
- SLA rules and timers
- Auto-close after N days and the client warning
- Email alerts
- Showing SLA state in the list
