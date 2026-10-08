# Stage 2B: SLA, Auto-close and Email Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** finish the tickets stage:
- every ticket gets SLA due times from company rules, using business hours and holidays;
- the inbox shows "Due soon" and "Overdue";
- Answered tickets close by themselves after N days, with a warning to the client;
- staff get link-only emails for new, reopened, near-breach and breached tickets.

It also closes the access gaps left over from 2A.

**Architecture:**
- **Calendar.** `src/lib/sla/calendar.ts` is a pure business-time calendar that adds and counts business minutes in the company time zone, skipping holidays.
- **SLA rules and clock.** `src/lib/sla/rules.ts` picks the most specific rule. `src/lib/sla/clock.ts` turns a rule into stored due and warn times and reads a ticket's SLA state.
- **One write path.** Every ticket write that changes status, priority, project, category or source goes through `saveTicket()` in `src/lib/tickets/update.ts`. That function pauses the resolution clock while a ticket is Answered and recomputes due times.
- **Emails.** Emails are queued in an `EmailOutbox` table. A worker process (`npm run worker`) runs every minute for each company. It closes tickets, sends SLA alerts and sends the queued emails, retrying failures.

**Tech Stack:** Next.js 16, Prisma 7 with the stage 1B tenant extension, PostgreSQL 18, nodemailer 10, Vitest (unit and real-database integration), tsx for the worker.

Spec: `docs/specs/2026-10-04-helplus-design.md`, sections "2. Tickets" (auto-close, reopen), "SLA", "Emails" and "Errors" (email server down).

## Global Constraints

- Code name `helplus`, display name "Help+". No "owly" anywhere except `LICENSE`.
- Comments only when needed: one short plain line, written like a person would ("copy before any await, ios blocks it after"). No multi-clause explanations, no "This function...", no emoji.
- Commit messages are short and lowercase, with no Co-Authored-By trailer. Commit locally only; never push or open a PR.
- Before every commit, these must pass: `npx vitest run`, `npx tsc --noEmit`, `npm run test:integration`. The last commit of a UI task also needs `npm run lint` (0 errors) and `npm run smoke`.
- Look: indigo `#3B3FA6`, warm greys, IBM Plex, lucide icons, no emoji. Status is a coloured dot plus text.
- Text colours are only `text-helplus-{text,text-light,link,danger,success,warning}`, plus `text-white` on primary buttons. The contrast guard test enforces this.
- Every screen must work at 390px wide.
- Every query goes through the scoped `prisma`. `systemPrisma` is only for looping over companies in the worker.
- Writes use scalar foreign keys, never `connect`. Nested relation writes are refused, except `Customer.notes` create.
- The link check runs outside transactions, so create parent rows before children.
- Emails are link only: ticket number and a link to `/tickets/<id>`. Never message text, ticket titles, screenshots or IC numbers.
- Statuses: `new`, `ai_suggested`, `answered`, `reopened`, `working`, `closed`. Use `statusChange()` and `canMove()` from `src/lib/tickets/status.ts`; never write a status string directly.
- Local databases: ServBay Postgres. Dev db is `helpplus`, test db is `helpplus_test`, user `helpplus`, password `helpplus_dev_2026`. psql and pg_dump are in `/c/ServBay/packages/postgresql/18/bin/`.
- A dev server runs on :3000. Before `prisma generate` or `next build`, stop it with PowerShell `Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess -Force -Confirm:$false`. Restart it with `cd /d/development/helpdeskAI2 && (nohup npm run dev > ../helpdeskAI2-dev.log 2>&1 &)`. If tsc complains about `.next/dev/types`, delete that folder.

---

## Decisions this plan makes

User decisions (2026-10-07):
- **A client message on an Answered (or AI Suggested) ticket moves it to Staff working.** It doesn't count as a reopen, so a "thanks" doesn't inflate reopen numbers. The SLA clock resumes and auto-close stops.
- **Auto-close defaults to 3 days** for every company and can be changed in Settings > Closing tickets. 0 means staff close only.
- **Client warning:** one day before auto-close, the client gets a plain email (ticket number only, no link) if we have their email address. Without an email there is no warning; staff see "Closes tomorrow" on the ticket.

Plan decisions:
- **SLA clocks.**
  - First reply is met when `firstReplyAt` is set. The AI doesn't count.
  - Resolution is met when the ticket closes. It is paused while Answered. Time spent Closed before a reopen also doesn't count.
  - Near breach starts at 80% of the target.
- **Rule choice.** A rule matches when each field is "all" or equal to the ticket's. The most specific match wins, scored project 8, priority 4, category 2, source 1. On a tie, the shorter first-reply target wins. The old `SLARule.channel` column is renamed `source`; its values (whatsapp, email, phone) already match `Ticket.source`.
- **Rule changes aren't retroactive.** They apply to new tickets, and to tickets whose priority, project, category or source changes. Tickets that existed before this stage have no SLA until one of those changes.
- **Business hours.** Holidays only count while business hours are on. With business hours off, the clocks run on wall time.
- **AI Suggested** is set when the AI's reply is saved on a New ticket, and only when the AI call worked.
- **Email recipients.**
  - New ticket: users who opted in (`notifyNew`) and can see the project.
  - Reopened: the assignee, unless they did it.
  - SLA warning: the assignee, or supervisors, admins and owners when nobody is assigned.
  - Breach: the assignee plus supervisors, admins and owners.
  - Users need an email address on their account (new `Admin.email`).
  - "Staff reply" and "closed" emails to clients come with the client side in stage 5.
- **Email failures.** Up to 5 attempts, 2, 4, 8 and 16 minutes apart. Failures show on a new Settings > Email log page with a Retry button.
- **The worker** is a separate process (`npm run worker`), as the spec's "worker as a second process" asks. `npm run worker -- --once` runs one pass.

## File map

| File | Status | Job |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261008000000_sla_closing_emails/migration.sql` | modify / new | Holiday, EmailOutbox, SLA columns on Ticket, SLARule.source, projectId and category, Settings.autoCloseDays, Admin.email and notifyNew |
| `src/lib/sla/calendar.ts` | new | business minutes: add and count, time zones, holidays |
| `src/lib/sla/load-calendar.ts` | new | company calendar from BusinessHours and Holiday |
| `src/lib/sla/rules.ts` | new | `pickRule` |
| `src/lib/sla/clock.ts` | new | `slaTimes`, `slaState`, `slaWhere` |
| `src/lib/tickets/update.ts` | new | `saveTicket`, `slaChanges`, `loadSlaContext` |
| `src/lib/notify/templates.ts`, `recipients.ts`, `outbox.ts`, `notify.ts` | new | email text, who gets it, queue and send |
| `src/lib/jobs/auto-close.ts`, `sla-alerts.ts`, `run.ts`, `scripts/worker.ts` | new | background jobs |
| `src/app/api/sla/**`, `src/app/api/holidays/**`, `src/app/api/email-outbox/**` | modify / new | settings APIs |
| `src/app/(dashboard)/sla/page.tsx`, `closing/page.tsx`, `email-log/page.tsx`, `src/components/settings/holidays-card.tsx` | rewrite / new | settings screens |
| `src/components/tickets/sla-badge.tsx`, tickets list and detail | new / modify | Due soon, Overdue, Closes tomorrow |
| customers, conversations and stats routes | modify | 2A carry-overs |

---

### Task 1: Database: SLA fields, holidays, email outbox, settings

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/tenant/links.ts`, `src/lib/rbac.ts`, `src/lib/validations.ts`, `src/app/api/sla/route.ts`, `src/app/api/sla/[id]/route.ts`, `src/app/(dashboard)/sla/page.tsx`, `src/lib/conversation-engine.ts`, `tests/setup.ts`, `tests/unit/rbac.test.ts`
- Create: `prisma/migrations/20261008000000_sla_closing_emails/migration.sql`, `tests/integration/sla-schema.test.ts`

**Interfaces:**
- Produces:
  - Prisma model `Holiday { id, companyId, date: string "YYYY-MM-DD", name, createdAt }`, unique on `(companyId, date)`.
  - Prisma model `EmailOutbox { id, companyId, to, subject, body, kind, ticketId?, status "pending"|"sent"|"failed", attempts, lastError, nextAttemptAt, sentAt?, createdAt }`.
  - `SLARule` gets `source` (renamed from `channel`), `projectId?` and `category` (default "all").
  - `Ticket` gets `slaRuleId?`, `firstReplyWarnAt?`, `firstReplyDueAt?`, `resolveWarnAt?`, `resolveDueAt?`, `slaPausedAt?`, `slaPausedMins` (default 0), `slaWarnedAt?`, `slaBreachedAt?` and `closeWarnedAt?`.
  - `Settings.autoCloseDays` (default 3), plus `Admin.email` (default "") and `Admin.notifyNew` (default false).
  - Permission `"emails:manage"` for admin and owner.

- [ ] **Step 1: Schema**

In `prisma/schema.prisma`:

`model Company`: add these next to the other back-relations:

```prisma
  holidays          Holiday[]
  emailOutbox       EmailOutbox[]
```

`model Admin`: add after `role`:

```prisma
  email     String   @default("")
  notifyNew Boolean  @default(false)
```

`model Settings`: add `autoCloseDays         Int      @default(3)`.

`model Project`: add `slaRules  SLARule[]`.

`model SLARule`: replace the `channel` line and add the new fields:

```prisma
  source            String   @default("all") // all or a ticket source, e.g. whatsapp
  projectId         String?
  project           Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)
  category          String   @default("all")
  tickets           Ticket[]
```

Also add `@@index([projectId])` to `SLARule`. Keep `priority` as is; its values are all, low, medium, high, urgent.

`model Ticket`: add these after `aiMatch`:

```prisma
  slaRuleId        String?
  slaRule          SLARule?      @relation(fields: [slaRuleId], references: [id], onDelete: SetNull)
  firstReplyWarnAt DateTime?
  firstReplyDueAt  DateTime?
  resolveWarnAt    DateTime?
  resolveDueAt     DateTime?
  slaPausedAt      DateTime?
  slaPausedMins    Int           @default(0)
  slaWarnedAt      DateTime?
  slaBreachedAt    DateTime?
  closeWarnedAt    DateTime?
  emails           EmailOutbox[]
```

Also add `@@index([slaRuleId])` and `@@index([resolveDueAt])` to `Ticket`.

New models, placed after `model BusinessHours`:

```prisma
model Holiday {
  id        String   @id @default(uuid())
  companyId String   @default("")
  company   Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  date      String // YYYY-MM-DD in the company time zone
  name      String   @default("")
  createdAt DateTime @default(now())

  @@unique([companyId, date])
  @@index([companyId])
}

model EmailOutbox {
  id            String    @id @default(uuid())
  companyId     String    @default("")
  company       Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  to            String
  subject       String
  body          String
  kind          String
  ticketId      String?
  ticket        Ticket?   @relation(fields: [ticketId], references: [id], onDelete: SetNull)
  status        String    @default("pending") // pending, sent, failed
  attempts      Int       @default(0)
  lastError     String    @default("")
  nextAttemptAt DateTime  @default(now())
  sentAt        DateTime?
  createdAt     DateTime  @default(now())

  @@index([companyId, status, nextAttemptAt])
  @@index([ticketId])
}
```

Run: `npx prisma validate`. Expected: valid.

- [ ] **Step 2: Migration**

Create `prisma/migrations/20261008000000_sla_closing_emails/migration.sql`:

```sql
-- sla rules: channel becomes source, plus project and category overrides
ALTER TABLE "SLARule" RENAME COLUMN "channel" TO "source";
ALTER TABLE "SLARule" ADD COLUMN "projectId" TEXT, ADD COLUMN "category" TEXT NOT NULL DEFAULT 'all';
CREATE INDEX "SLARule_projectId_idx" ON "SLARule"("projectId");
ALTER TABLE "SLARule" ADD CONSTRAINT "SLARule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- holidays
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Holiday_companyId_date_key" ON "Holiday"("companyId", "date");
CREATE INDEX "Holiday_companyId_idx" ON "Holiday"("companyId");
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- sla times on tickets
ALTER TABLE "Ticket"
  ADD COLUMN "slaRuleId" TEXT,
  ADD COLUMN "firstReplyWarnAt" TIMESTAMP(3),
  ADD COLUMN "firstReplyDueAt" TIMESTAMP(3),
  ADD COLUMN "resolveWarnAt" TIMESTAMP(3),
  ADD COLUMN "resolveDueAt" TIMESTAMP(3),
  ADD COLUMN "slaPausedAt" TIMESTAMP(3),
  ADD COLUMN "slaPausedMins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "slaWarnedAt" TIMESTAMP(3),
  ADD COLUMN "slaBreachedAt" TIMESTAMP(3),
  ADD COLUMN "closeWarnedAt" TIMESTAMP(3);
CREATE INDEX "Ticket_slaRuleId_idx" ON "Ticket"("slaRuleId");
CREATE INDEX "Ticket_resolveDueAt_idx" ON "Ticket"("resolveDueAt");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_slaRuleId_fkey" FOREIGN KEY ("slaRuleId") REFERENCES "SLARule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- settings and users
ALTER TABLE "Settings" ADD COLUMN "autoCloseDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Admin" ADD COLUMN "email" TEXT NOT NULL DEFAULT '', ADD COLUMN "notifyNew" BOOLEAN NOT NULL DEFAULT false;

-- email queue
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ticketId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailOutbox_companyId_status_nextAttemptAt_idx" ON "EmailOutbox"("companyId", "status", "nextAttemptAt");
CREATE INDEX "EmailOutbox_ticketId_idx" ON "EmailOutbox"("ticketId");
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Back up the dev db, then apply the migration to it:

```bash
PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/pg_dump.exe -h localhost -U helpplus -d helpplus -Fc -f .superpowers/backup/helpplus-before-2b.dump
PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/psql.exe -h localhost -U helpplus -d helpplus -v ON_ERROR_STOP=1 -f prisma/migrations/20261008000000_sla_closing_emails/migration.sql
npx prisma db push && npx prisma generate
```

Expected: psql finishes with no `ERROR`, and `db push` reports the database is already in sync. Stop the dev server before `generate`. If `db push` wants to change anything else, stop and report.

Apply it to the test db:

```bash
DATABASE_URL="postgresql://helpplus:helpplus_dev_2026@localhost:5432/helpplus_test?schema=public" npx prisma migrate deploy
```

Expected: `1 migration applied`.

- [ ] **Step 3: Rename `channel` to `source` in the SLA code, and remove dead code**

- `src/lib/validations.ts`: replace `createSLARuleSchema` with:

```ts
export const createSLARuleSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().max(1000).optional(),
  projectId: z.string().max(100).nullable().optional(),
  priority: z.enum(["all", "low", "medium", "high", "urgent"]).default("all"),
  category: z.string().trim().max(100).default("all"),
  source: z.string().trim().max(50).default("all"),
  firstResponseMins: z.number().int().min(1).max(10080),
  resolutionMins: z.number().int().min(1).max(43200),
  isActive: z.boolean().default(true),
});
export const updateSLARuleSchema = createSLARuleSchema.partial();
```

- In `src/app/api/sla/route.ts` and `src/app/api/sla/[id]/route.ts`:
  - Validate the body with `createSLARuleSchema` (POST) and `updateSLARuleSchema` (PUT), using `validateBody`.
  - Write `source`, `projectId`, `category` and `priority` from the validated data.
  - On a `projectId`, first check the project exists with `prisma.project.findFirst({ where: { id } })`. If it doesn't, return 400 "Project not found".
  - GET includes `project: { select: { id: true, name: true } }`.
- In `src/app/(dashboard)/sla/page.tsx`, rename every `channel` to `source` so tsc passes. Task 7 rewrites this page.
- In `src/lib/conversation-engine.ts`, delete `checkSLABreaches`. It has no callers (check with `git grep -n checkSLABreaches`) and the worker replaces it. Remove any imports that become unused.

- [ ] **Step 4: Links, permissions, test mocks**

`src/lib/tenant/links.ts`:
- Add to `LINKS`:
  - `SLARule: { projectId: "Project" }`
  - `slaRuleId: "SLARule"` in the `Ticket` entry
  - `EmailOutbox: { ticketId: "Ticket" }`
- Add the matching `RELATIONS` entries:
  - `Project.slaRules`
  - `SLARule.project` and `SLARule.tickets`
  - `Ticket.slaRule` and `Ticket.emails`
  - `EmailOutbox.ticket`
- Run `npx vitest run tests/unit/tenant-links.test.ts` and follow what it reports. Don't edit that test.

`src/lib/rbac.ts`: add before `"company:manage"`:

```ts
  // Email log
  "emails:manage": ["admin", "owner"],
```

`tests/unit/rbac.test.ts`: add:

```ts
  it("only admins and owners manage the email log", () => {
    expect(hasPermission("supervisor", "emails:manage")).toBe(false);
    expect(hasPermission("admin", "emails:manage")).toBe(true);
  });
```

`tests/setup.ts`: add `"holiday"` and `"emailOutbox"` to the mocked `models` list. `sLARule` is already there; check.

- [ ] **Step 5: Integration test for the schema**

Create `tests/integration/sla-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { CrossCompanyLinkError } from "@/lib/tenant/links";

const A = "it-2b-schema-a";
const B = "it-2b-schema-b";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({ data: [{ id: A, name: "A", slug: A }, { id: B, name: "B", slug: B }] });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("2b schema", () => {
  it("one holiday per date per company", async () => {
    await runWithCompany(A, () => prisma.holiday.create({ data: { date: "2026-12-25", name: "Christmas" } }));
    await runWithCompany(B, () => prisma.holiday.create({ data: { date: "2026-12-25" } }));
    await expect(
      runWithCompany(A, () => prisma.holiday.create({ data: { date: "2026-12-25" } }))
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("an sla rule can't point at another company's project", async () => {
    const pA = await runWithCompany(A, () => prisma.project.create({ data: { name: "Alpha" } }));
    await expect(
      runWithCompany(B, () =>
        prisma.sLARule.create({ data: { name: "x", projectId: pA.id, firstResponseMins: 60, resolutionMins: 480 } })
      )
    ).rejects.toThrow(CrossCompanyLinkError);
  });

  it("new settings default to closing after 3 days", async () => {
    const s = await runWithCompany(A, () => prisma.settings.create({ data: {} }));
    expect(s.autoCloseDays).toBe(3);
  });
});
```

Run: `npm run test:integration`. Expected: all pass.

- [ ] **Step 6: Check and commit**

Run:
- `npx tsc --noEmit`: expect clean.
- `npx vitest run`: expect all pass. Fix the SLA route tests for the renamed field.
- `npm run test:integration`: expect all pass.

Restart the dev server.

```bash
git add prisma src tests
git commit -m "sla fields, holidays, email outbox and auto-close setting"
```

---

### Task 2: Business-hours calendar

**Files:**
- Create: `src/lib/sla/calendar.ts`, `src/lib/sla/load-calendar.ts`, `tests/unit/sla-calendar.test.ts`, `tests/integration/sla-calendar-load.test.ts`

**Interfaces:**
- Consumes: `BusinessHours` and `Holiday` (Task 1).
- Produces:
  - `interface BusinessCalendar { enabled: boolean; timezone: string; week: ([number, number] | null)[]; holidays: Set<string> }`
  - `ALWAYS_OPEN: BusinessCalendar`
  - `parseHours(value: string): [number, number] | null`
  - `addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date`
  - `businessMinutesBetween(from: Date, to: Date, cal: BusinessCalendar): number`
  - `loadCalendar(): Promise<BusinessCalendar>`

- [ ] **Step 1: Test first**

Create `tests/unit/sla-calendar.test.ts`. Dates: 2026-10-05 is a Monday. Kuala Lumpur is UTC+8 with no DST. London leaves summer time on Sunday 2026-10-25.

```ts
import { describe, it, expect } from "vitest";
import {
  addBusinessMinutes,
  businessMinutesBetween,
  parseHours,
  ALWAYS_OPEN,
  type BusinessCalendar,
} from "@/lib/sla/calendar";

const nineToSix: [number, number] = [540, 1080];
const weekdays = (tz: string, holidays: string[] = []): BusinessCalendar => ({
  enabled: true,
  timezone: tz,
  week: [null, nineToSix, nineToSix, nineToSix, nineToSix, nineToSix, null],
  holidays: new Set(holidays),
});
const KL = weekdays("Asia/Kuala_Lumpur");
const at = (iso: string) => new Date(iso);

describe("parseHours", () => {
  it("reads a window", () => {
    expect(parseHours("09:00-18:00")).toEqual([540, 1080]);
    expect(parseHours("00:00-24:00")).toEqual([0, 1440]);
  });
  it("treats empty or broken values as closed", () => {
    expect(parseHours("")).toBeNull();
    expect(parseHours("18:00-09:00")).toBeNull();
    expect(parseHours("9am-5pm")).toBeNull();
  });
});

describe("addBusinessMinutes", () => {
  it("stays inside the same day", () => {
    expect(addBusinessMinutes(at("2026-10-05T02:00:00Z"), 120, KL)).toEqual(at("2026-10-05T04:00:00Z"));
  });

  it("carries over to the next morning", () => {
    // mon 17:00 + 2h = tue 10:00 KL
    expect(addBusinessMinutes(at("2026-10-05T09:00:00Z"), 120, KL)).toEqual(at("2026-10-06T02:00:00Z"));
  });

  it("skips the weekend", () => {
    // fri 17:00 + 2h = mon 10:00 KL
    expect(addBusinessMinutes(at("2026-10-09T09:00:00Z"), 120, KL)).toEqual(at("2026-10-12T02:00:00Z"));
  });

  it("starts at opening time when created on a weekend", () => {
    expect(addBusinessMinutes(at("2026-10-10T04:00:00Z"), 30, KL)).toEqual(at("2026-10-12T01:30:00Z"));
  });

  it("starts at opening time when created before hours", () => {
    // mon 07:00 KL + 1h = mon 10:00 KL
    expect(addBusinessMinutes(at("2026-10-04T23:00:00Z"), 60, KL)).toEqual(at("2026-10-05T02:00:00Z"));
  });

  it("skips holidays", () => {
    const cal = weekdays("Asia/Kuala_Lumpur", ["2026-10-06"]);
    expect(addBusinessMinutes(at("2026-10-05T09:00:00Z"), 120, cal)).toEqual(at("2026-10-07T02:00:00Z"));
  });

  it("follows a clock change", () => {
    // fri 17:00 BST + 2h = mon 10:00 GMT
    const london = weekdays("Europe/London");
    expect(addBusinessMinutes(at("2026-10-23T16:00:00Z"), 120, london)).toEqual(at("2026-10-26T10:00:00Z"));
  });

  it("uses wall time when business hours are off", () => {
    expect(addBusinessMinutes(at("2026-10-10T04:00:00Z"), 90, ALWAYS_OPEN)).toEqual(at("2026-10-10T05:30:00Z"));
  });

  it("falls back to UTC for an unknown zone", () => {
    const cal = { ...weekdays("Not/AZone") };
    expect(addBusinessMinutes(at("2026-10-05T10:00:00Z"), 60, cal)).toEqual(at("2026-10-05T11:00:00Z"));
  });
});

describe("businessMinutesBetween", () => {
  it("counts only open time", () => {
    expect(businessMinutesBetween(at("2026-10-05T09:00:00Z"), at("2026-10-06T02:00:00Z"), KL)).toBe(120);
    expect(businessMinutesBetween(at("2026-10-09T09:00:00Z"), at("2026-10-12T02:00:00Z"), KL)).toBe(120);
  });

  it("is zero when the end is not after the start", () => {
    expect(businessMinutesBetween(at("2026-10-06T02:00:00Z"), at("2026-10-05T02:00:00Z"), KL)).toBe(0);
  });

  it("matches addBusinessMinutes", () => {
    const start = at("2026-10-08T05:13:00Z");
    const end = addBusinessMinutes(start, 1000, KL);
    expect(businessMinutesBetween(start, end, KL)).toBe(1000);
  });
});
```

Run: `npx vitest run tests/unit/sla-calendar.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 2: Calendar**

Create `src/lib/sla/calendar.ts`:

```ts
export interface BusinessCalendar {
  enabled: boolean;
  timezone: string;
  // index 0 is sunday. minutes from local midnight, null when closed
  week: ([number, number] | null)[];
  holidays: Set<string>; // YYYY-MM-DD, local
}

export const ALWAYS_OPEN: BusinessCalendar = { enabled: false, timezone: "UTC", week: [], holidays: new Set() };

const MINUTE = 60_000;
const MAX_DAYS = 730;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseHours(value: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (start >= end || end > 1440) return null;
  return [start, end];
}

function safeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

interface LocalDay {
  y: number;
  m: number;
  d: number;
  weekday: number;
}

function localParts(t: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(t));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    min: Number(p.minute),
    s: Number(p.second),
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

function offsetMs(t: number, tz: string): number {
  const p = localParts(t, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - (t - (t % 1000));
}

// utc time of a local wall clock time, twice to get the offset right around clock changes
function zonedTime(day: LocalDay, minuteOfDay: number, tz: string): number {
  const guess = Date.UTC(day.y, day.m - 1, day.d, 0, minuteOfDay);
  const first = guess - offsetMs(guess, tz);
  return guess - offsetMs(first, tz);
}

function dayOf(t: number, tz: string): LocalDay {
  const p = localParts(t, tz);
  return { y: p.y, m: p.m, d: p.d, weekday: p.weekday };
}

function nextDay(day: LocalDay): LocalDay {
  const n = new Date(Date.UTC(day.y, day.m - 1, day.d + 1));
  return { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1, d: n.getUTCDate(), weekday: (day.weekday + 1) % 7 };
}

function key(day: LocalDay): string {
  return `${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
}

function windowOf(cal: BusinessCalendar, day: LocalDay, tz: string): [number, number] | null {
  if (cal.holidays.has(key(day))) return null;
  const w = cal.week[day.weekday];
  return w ? [zonedTime(day, w[0], tz), zonedTime(day, w[1], tz)] : null;
}

export function addBusinessMinutes(start: Date, minutes: number, cal: BusinessCalendar): Date {
  if (!cal.enabled) return new Date(start.getTime() + minutes * MINUTE);
  const tz = safeZone(cal.timezone);
  let cursor = start.getTime();
  let left = minutes * MINUTE;
  let day = dayOf(cursor, tz);
  for (let i = 0; i < MAX_DAYS; i++) {
    const win = windowOf(cal, day, tz);
    if (win) {
      const from = Math.max(cursor, win[0]);
      if (from < win[1]) {
        if (from + left <= win[1]) return new Date(from + left);
        left -= win[1] - from;
      }
    }
    day = nextDay(day);
    cursor = zonedTime(day, 0, tz);
  }
  throw new Error("no business hours in the next two years");
}

export function businessMinutesBetween(from: Date, to: Date, cal: BusinessCalendar): number {
  const a = from.getTime();
  const b = to.getTime();
  if (b <= a) return 0;
  if (!cal.enabled) return Math.floor((b - a) / MINUTE);
  const tz = safeZone(cal.timezone);
  let total = 0;
  let day = dayOf(a, tz);
  for (let i = 0; i < MAX_DAYS; i++) {
    if (zonedTime(day, 0, tz) >= b) break;
    const win = windowOf(cal, day, tz);
    if (win) total += Math.max(0, Math.min(b, win[1]) - Math.max(a, win[0]));
    day = nextDay(day);
  }
  return Math.floor(total / MINUTE);
}
```

The "unknown zone" test needs `safeZone` to fall back to UTC. With UTC, Mon 10:00Z is inside 09:00-18:00, so 60 minutes later is 11:00Z.

Run the test. Expected: PASS (14 tests). If the London case fails, check `zonedTime` around the clock change before changing any test.

- [ ] **Step 3: Loader**

Create `src/lib/sla/load-calendar.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { currentCompanyId } from "@/lib/tenant/context";
import { ALWAYS_OPEN, parseHours, type BusinessCalendar } from "./calendar";

// holidays only count while business hours are on
export async function loadCalendar(): Promise<BusinessCalendar> {
  const [hours, holidays] = await Promise.all([
    prisma.businessHours.findUnique({ where: { companyId: currentCompanyId() } }),
    prisma.holiday.findMany({ select: { date: true } }),
  ]);
  if (!hours?.enabled) return ALWAYS_OPEN;
  const week = [hours.sunday, hours.monday, hours.tuesday, hours.wednesday, hours.thursday, hours.friday, hours.saturday].map(
    parseHours
  );
  if (week.every((w) => !w)) return ALWAYS_OPEN;
  return { enabled: true, timezone: hours.timezone, week, holidays: new Set(holidays.map((h) => h.date)) };
}
```

Create `tests/integration/sla-calendar-load.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { loadCalendar } from "@/lib/sla/load-calendar";

const A = "it-2b-cal";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "A", slug: A } });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
});

describe("loadCalendar", () => {
  it("is always open until business hours are on", async () => {
    const cal = await runWithCompany(A, loadCalendar);
    expect(cal.enabled).toBe(false);
  });

  it("reads the week and holidays", async () => {
    const cal = await runWithCompany(A, async () => {
      await prisma.businessHours.create({ data: { enabled: true, timezone: "Asia/Kuala_Lumpur" } });
      await prisma.holiday.create({ data: { date: "2026-12-25" } });
      return loadCalendar();
    });
    expect(cal.enabled).toBe(true);
    expect(cal.week[1]).toEqual([540, 1080]);
    expect(cal.week[0]).toBeNull();
    expect(cal.holidays.has("2026-12-25")).toBe(true);
  });
});
```

Run: `npm run test:integration`. Expected: all pass.

- [ ] **Step 4: Commit**

Run `npx tsc --noEmit`, `npx vitest run` and `npm run test:integration`. All must pass.

```bash
git add src tests
git commit -m "business hours calendar for sla clocks"
```

---

### Task 3: SLA clocks and one way to save tickets

**Files:**
- Create: `src/lib/sla/rules.ts`, `src/lib/sla/clock.ts`, `src/lib/tickets/update.ts`, `tests/unit/sla-rules.test.ts`, `tests/unit/sla-clock.test.ts`, `tests/unit/ticket-update.test.ts`, `tests/integration/sla-tickets.test.ts`
- Modify: `src/lib/tickets/service.ts` (openTicket), `src/app/api/tickets/[id]/route.ts` (PATCH), `src/app/api/tickets/[id]/messages/route.ts`, `src/lib/ai/tools.ts` (assignToPerson)

**Interfaces:**
- Consumes: `BusinessCalendar`, `addBusinessMinutes`, `businessMinutesBetween`, `loadCalendar` (Task 2); `statusChange` (2A).
- Produces:
  - `pickRule<R extends RuleLike>(rules: R[], t: TicketMatch): R | null`
  - `slaTimes(createdAt: Date, pausedMins: number, rule: { id: string; firstResponseMins: number; resolutionMins: number } | null, cal: BusinessCalendar): SlaTimes`
  - `type SlaState = "none" | "ok" | "near" | "breached" | "paused" | "met" | "missed"` and `slaState(t: SlaTicket, now: Date): SlaState`
  - `slaWhere(state: "near" | "breached", now: Date): Record<string, unknown>`
  - `interface SlaContext { rules: SLARule[]; cal: BusinessCalendar }` and `loadSlaContext(): Promise<SlaContext>`
  - `slaChanges(before: Ticket, data: Record<string, unknown>, ctx: SlaContext, now: Date): Record<string, unknown>`
  - `saveTicket(before: Ticket, data: Record<string, unknown>, opts?: { now?: Date; ctx?: SlaContext; actorId?: string; db?: typeof prisma }): Promise<Ticket>`

`Ticket` and `SLARule` are the generated Prisma types: `import type { Ticket, SLARule } from "@/generated/prisma/client"`, the path the codebase already uses. Check with `git grep -n "generated/prisma/client" src`.

- [ ] **Step 1: Rule choice, test first**

Create `tests/unit/sla-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickRule } from "@/lib/sla/rules";

const rule = (over: Partial<Parameters<typeof pickRule>[0][number]>) => ({
  id: "r",
  projectId: null as string | null,
  priority: "all",
  category: "all",
  source: "all",
  firstResponseMins: 60,
  resolutionMins: 480,
  isActive: true,
  ...over,
});
const ticket = { projectId: "p1", priority: "high", category: "Login", source: "whatsapp" };

describe("pickRule", () => {
  it("uses the company default when nothing else matches", () => {
    expect(pickRule([rule({ id: "default" })], ticket)?.id).toBe("default");
  });

  it("prefers the most specific match", () => {
    const rules = [
      rule({ id: "default" }),
      rule({ id: "high", priority: "high" }),
      rule({ id: "project", projectId: "p1" }),
      rule({ id: "project-high", projectId: "p1", priority: "high" }),
    ];
    expect(pickRule(rules, ticket)?.id).toBe("project-high");
  });

  it("project beats priority, category and source together", () => {
    const rules = [rule({ id: "detail", priority: "high", category: "login", source: "whatsapp" }), rule({ id: "project", projectId: "p1" })];
    expect(pickRule(rules, ticket)?.id).toBe("project");
  });

  it("skips rules for other values and inactive rules", () => {
    const rules = [rule({ id: "other", projectId: "p2" }), rule({ id: "low", priority: "low" }), rule({ id: "off", isActive: false })];
    expect(pickRule(rules, ticket)).toBeNull();
  });

  it("matches category without caring about case", () => {
    expect(pickRule([rule({ id: "c", category: "login" })], ticket)?.id).toBe("c");
  });

  it("on a tie, takes the shorter first reply", () => {
    const rules = [rule({ id: "slow", priority: "high", firstResponseMins: 120 }), rule({ id: "fast", priority: "high", firstResponseMins: 30 })];
    expect(pickRule(rules, ticket)?.id).toBe("fast");
  });
});
```

Create `src/lib/sla/rules.ts`:

```ts
export interface RuleLike {
  id: string;
  projectId: string | null;
  priority: string;
  category: string;
  source: string;
  firstResponseMins: number;
  isActive: boolean;
}

export interface TicketMatch {
  projectId: string;
  priority: string;
  category: string;
  source: string;
}

// most specific rule wins: project, then priority, category, source
export function pickRule<R extends RuleLike>(rules: R[], t: TicketMatch): R | null {
  let best: R | null = null;
  let bestScore = -1;
  for (const r of rules) {
    if (!r.isActive) continue;
    if (r.projectId && r.projectId !== t.projectId) continue;
    if (r.priority !== "all" && r.priority !== t.priority) continue;
    if (r.category !== "all" && r.category.toLowerCase() !== t.category.toLowerCase()) continue;
    if (r.source !== "all" && r.source !== t.source) continue;
    const score =
      (r.projectId ? 8 : 0) + (r.priority !== "all" ? 4 : 0) + (r.category !== "all" ? 2 : 0) + (r.source !== "all" ? 1 : 0);
    if (score > bestScore || (score === bestScore && best && r.firstResponseMins < best.firstResponseMins)) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}
```

Run: `npx vitest run tests/unit/sla-rules.test.ts`. Expected: PASS (6).

- [ ] **Step 2: Clock, test first**

Create `tests/unit/sla-clock.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { slaTimes, slaState, slaWhere } from "@/lib/sla/clock";
import { ALWAYS_OPEN } from "@/lib/sla/calendar";

const created = new Date("2026-10-05T00:00:00Z");
const rule = { id: "r1", firstResponseMins: 100, resolutionMins: 1000 };
const min = (n: number) => new Date(created.getTime() + n * 60_000);

describe("slaTimes", () => {
  it("sets warn at 80% and due at 100%", () => {
    expect(slaTimes(created, 0, rule, ALWAYS_OPEN)).toEqual({
      slaRuleId: "r1",
      firstReplyWarnAt: min(80),
      firstReplyDueAt: min(100),
      resolveWarnAt: min(800),
      resolveDueAt: min(1000),
    });
  });

  it("pushes only the resolution clock by paused time", () => {
    const t = slaTimes(created, 50, rule, ALWAYS_OPEN);
    expect(t.firstReplyDueAt).toEqual(min(100));
    expect(t.resolveDueAt).toEqual(min(1050));
  });

  it("clears everything without a rule", () => {
    expect(slaTimes(created, 0, null, ALWAYS_OPEN)).toEqual({
      slaRuleId: null,
      firstReplyWarnAt: null,
      firstReplyDueAt: null,
      resolveWarnAt: null,
      resolveDueAt: null,
    });
  });
});

const base = {
  status: "new",
  firstReplyAt: null as Date | null,
  closedAt: null as Date | null,
  slaPausedAt: null as Date | null,
  ...slaTimes(created, 0, rule, ALWAYS_OPEN),
};

describe("slaState", () => {
  it("walks from ok to near to breached on the first reply clock", () => {
    expect(slaState(base, min(10))).toBe("ok");
    expect(slaState(base, min(85))).toBe("near");
    expect(slaState(base, min(101))).toBe("breached");
  });

  it("stops the first reply clock once someone replied", () => {
    expect(slaState({ ...base, status: "working", firstReplyAt: min(20) }, min(101))).toBe("ok");
    expect(slaState({ ...base, status: "working", firstReplyAt: min(20) }, min(1001))).toBe("breached");
  });

  it("is paused while answered", () => {
    expect(slaState({ ...base, status: "answered", firstReplyAt: min(20), slaPausedAt: min(30) }, min(2000))).toBe("paused");
  });

  it("is met or missed once closed", () => {
    expect(slaState({ ...base, status: "closed", firstReplyAt: min(20), closedAt: min(500) }, min(3000))).toBe("met");
    expect(slaState({ ...base, status: "closed", firstReplyAt: min(20), closedAt: min(1200) }, min(3000))).toBe("missed");
    expect(slaState({ ...base, status: "closed", firstReplyAt: min(150), closedAt: min(500) }, min(3000))).toBe("missed");
  });

  it("is none without a rule", () => {
    expect(slaState({ ...base, ...slaTimes(created, 0, null, ALWAYS_OPEN) }, min(5000))).toBe("none");
  });
});

describe("slaWhere", () => {
  it("only looks at running tickets", () => {
    const now = min(5);
    expect(JSON.stringify(slaWhere("breached", now))).toContain('"slaPausedAt":null');
    expect(JSON.stringify(slaWhere("near", now))).toContain('"NOT"');
  });
});
```

Create `src/lib/sla/clock.ts`:

```ts
import { addBusinessMinutes, type BusinessCalendar } from "./calendar";

export const WARN_SHARE = 0.8;

export interface SlaTimes {
  slaRuleId: string | null;
  firstReplyWarnAt: Date | null;
  firstReplyDueAt: Date | null;
  resolveWarnAt: Date | null;
  resolveDueAt: Date | null;
}

export type SlaState = "none" | "ok" | "near" | "breached" | "paused" | "met" | "missed";

export interface SlaTicket {
  status: string;
  firstReplyAt: Date | null;
  closedAt: Date | null;
  slaPausedAt: Date | null;
  firstReplyWarnAt: Date | null;
  firstReplyDueAt: Date | null;
  resolveWarnAt: Date | null;
  resolveDueAt: Date | null;
}

export function slaTimes(
  createdAt: Date,
  pausedMins: number,
  rule: { id: string; firstResponseMins: number; resolutionMins: number } | null,
  cal: BusinessCalendar
): SlaTimes {
  if (!rule) {
    return { slaRuleId: null, firstReplyWarnAt: null, firstReplyDueAt: null, resolveWarnAt: null, resolveDueAt: null };
  }
  const add = (mins: number) => addBusinessMinutes(createdAt, mins, cal);
  return {
    slaRuleId: rule.id,
    firstReplyWarnAt: add(Math.floor(rule.firstResponseMins * WARN_SHARE)),
    firstReplyDueAt: add(rule.firstResponseMins),
    resolveWarnAt: add(Math.floor(rule.resolutionMins * WARN_SHARE) + pausedMins),
    resolveDueAt: add(rule.resolutionMins + pausedMins),
  };
}

const passed = (at: Date | null, now: Date, inclusive = false) =>
  !!at && (inclusive ? at.getTime() <= now.getTime() : at.getTime() < now.getTime());

export function slaState(t: SlaTicket, now: Date): SlaState {
  if (!t.firstReplyDueAt && !t.resolveDueAt) return "none";
  if (t.status === "closed") {
    const end = t.closedAt ?? now;
    const lateReply = !!t.firstReplyDueAt && (t.firstReplyAt ?? end).getTime() > t.firstReplyDueAt.getTime();
    const lateClose = !!t.resolveDueAt && end.getTime() > t.resolveDueAt.getTime();
    return lateReply || lateClose ? "missed" : "met";
  }
  if (t.slaPausedAt) return "paused";
  const waitingReply = !t.firstReplyAt;
  if ((waitingReply && passed(t.firstReplyDueAt, now)) || passed(t.resolveDueAt, now)) return "breached";
  if ((waitingReply && passed(t.firstReplyWarnAt, now, true)) || passed(t.resolveWarnAt, now, true)) return "near";
  return "ok";
}

// prisma filters for the inbox and the alert job
export function slaWhere(state: "near" | "breached", now: Date): Record<string, unknown> {
  const running = { status: { not: "closed" }, slaPausedAt: null };
  const breached = { OR: [{ firstReplyAt: null, firstReplyDueAt: { lt: now } }, { resolveDueAt: { lt: now } }] };
  if (state === "breached") return { AND: [running, breached] };
  const near = { OR: [{ firstReplyAt: null, firstReplyWarnAt: { lte: now } }, { resolveWarnAt: { lte: now } }] };
  return { AND: [running, near, { NOT: breached }] };
}
```

Run: `npx vitest run tests/unit/sla-clock.test.ts`. Expected: PASS.

- [ ] **Step 3: saveTicket, test first**

Create `tests/unit/ticket-update.test.ts`. It tests the pure `slaChanges`:

```ts
import { describe, it, expect } from "vitest";
import { slaChanges, type SlaContext } from "@/lib/tickets/update";
import { ALWAYS_OPEN } from "@/lib/sla/calendar";
import { slaTimes } from "@/lib/sla/clock";

const created = new Date("2026-10-05T00:00:00Z");
const min = (n: number) => new Date(created.getTime() + n * 60_000);
const rule = {
  id: "r1",
  companyId: "c",
  name: "default",
  description: "",
  projectId: null,
  priority: "all",
  category: "all",
  source: "all",
  firstResponseMins: 100,
  resolutionMins: 1000,
  isActive: true,
  createdAt: created,
  updatedAt: created,
};
const urgent = { ...rule, id: "r2", priority: "urgent", firstResponseMins: 10, resolutionMins: 100 };
const ctx: SlaContext = { rules: [rule, urgent], cal: ALWAYS_OPEN };
const ticket = {
  id: "t1",
  status: "working",
  priority: "medium",
  projectId: "p1",
  category: "",
  source: "whatsapp",
  createdAt: created,
  closedAt: null,
  firstReplyAt: min(5),
  slaPausedAt: null,
  slaPausedMins: 0,
  slaWarnedAt: null,
  slaBreachedAt: null,
  closeWarnedAt: null,
  ...slaTimes(created, 0, rule, ALWAYS_OPEN),
} as never;

describe("slaChanges", () => {
  it("pauses when the ticket is answered", () => {
    expect(slaChanges(ticket, { status: "answered" }, ctx, min(200))).toMatchObject({ slaPausedAt: min(200) });
  });

  it("adds the paused time when the ticket leaves answered", () => {
    const answered = { ...(ticket as object), status: "answered", slaPausedAt: min(200) } as never;
    const out = slaChanges(answered, { status: "working" }, ctx, min(500));
    expect(out).toMatchObject({ slaPausedAt: null, slaPausedMins: 300, resolveDueAt: min(1300), closeWarnedAt: null });
  });

  it("adds the closed time on reopen", () => {
    const closed = { ...(ticket as object), status: "closed", closedAt: min(400) } as never;
    expect(slaChanges(closed, { status: "reopened", closedAt: null }, ctx, min(600))).toMatchObject({ slaPausedMins: 200 });
  });

  it("picks a new rule when the priority changes", () => {
    expect(slaChanges(ticket, { priority: "urgent" }, ctx, min(1))).toMatchObject({ slaRuleId: "r2", resolveDueAt: min(100) });
  });

  it("clears old alerts once the ticket is back on time", () => {
    const late = { ...(ticket as object), slaBreachedAt: min(1001), slaWarnedAt: min(801), status: "answered", slaPausedAt: min(50) } as never;
    expect(slaChanges(late, { status: "working" }, ctx, min(1100))).toMatchObject({ slaWarnedAt: null, slaBreachedAt: null });
  });

  it("does nothing for unrelated changes", () => {
    expect(slaChanges(ticket, { title: "new title" }, ctx, min(1))).toEqual({});
  });
});
```

In the "clears old alerts" case, the ticket was answered from minute 50 to minute 1100. That pause adds 1050 minutes, which moves resolveDueAt to minute 2050. That makes it ok again.

Create `src/lib/tickets/update.ts`:

```ts
import type { SLARule, Ticket } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { businessMinutesBetween, type BusinessCalendar } from "@/lib/sla/calendar";
import { loadCalendar } from "@/lib/sla/load-calendar";
import { pickRule } from "@/lib/sla/rules";
import { slaState, slaTimes, type SlaTicket } from "@/lib/sla/clock";

export interface SlaContext {
  rules: SLARule[];
  cal: BusinessCalendar;
}

const SLA_INPUTS = ["priority", "projectId", "category", "source"] as const;

export async function loadSlaContext(): Promise<SlaContext> {
  const [rules, cal] = await Promise.all([prisma.sLARule.findMany({ where: { isActive: true } }), loadCalendar()]);
  return { rules, cal };
}

// the sla fields that go with a change, kept pure for tests
export function slaChanges(before: Ticket, data: Record<string, unknown>, ctx: SlaContext, now: Date): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const next = { ...before, ...data } as Ticket;
  let pausedMins = before.slaPausedMins;

  if (before.status === "answered" && next.status !== "answered") {
    if (before.slaPausedAt) pausedMins += businessMinutesBetween(before.slaPausedAt, now, ctx.cal);
    out.slaPausedAt = null;
    out.closeWarnedAt = null;
  }
  if (before.status === "closed" && next.status !== "closed" && before.closedAt) {
    pausedMins += businessMinutesBetween(before.closedAt, now, ctx.cal);
  }
  if (next.status === "answered" && before.status !== "answered") out.slaPausedAt = now;

  const inputsChanged = SLA_INPUTS.some((k) => k in data && data[k] !== before[k]);
  if (pausedMins !== before.slaPausedMins || inputsChanged) {
    out.slaPausedMins = pausedMins;
    Object.assign(out, slaTimes(before.createdAt, pausedMins, pickRule(ctx.rules, next), ctx.cal));
    const state = slaState({ ...next, ...out } as SlaTicket, now);
    if (state === "ok" || state === "paused") {
      out.slaWarnedAt = null;
      out.slaBreachedAt = null;
    } else if (state === "near") {
      out.slaBreachedAt = null;
    }
  }
  return out;
}

// every status, priority, project, category or source change goes through here
export async function saveTicket(
  before: Ticket,
  data: Record<string, unknown>,
  opts: { now?: Date; ctx?: SlaContext; actorId?: string; db?: typeof prisma } = {}
): Promise<Ticket> {
  const now = opts.now ?? new Date();
  const ctx = opts.ctx ?? (await loadSlaContext());
  const db = opts.db ?? prisma;
  return db.ticket.update({ where: { id: before.id }, data: { ...data, ...slaChanges(before, data, ctx, now) } });
}
```

Task 5 adds the reopened email inside `saveTicket`, using `opts.actorId`.

If the `db` option's type doesn't accept the interactive transaction client (`tx`) used in Task 9, change it to `Pick<typeof prisma, "ticket">`.

Run: `npx vitest run tests/unit/ticket-update.test.ts`. Expected: PASS (6).

- [ ] **Step 4: New tickets get SLA times**

In `src/lib/tickets/service.ts`, change `openTicket` to:

```ts
export async function openTicket(input: OpenTicketInput) {
  const description = maskIC(input.description).text;
  const title = maskIC(input.title?.trim() || titleFrom(description)).text;
  const now = new Date();
  const match = {
    projectId: input.projectId || (await defaultProjectId()),
    priority: input.priority ?? "medium",
    category: input.category ?? "",
    source: input.source,
  };
  const ctx = await loadSlaContext();
  return prisma.ticket.create({
    data: {
      number: await nextTicketNumber(),
      title,
      description,
      ...match,
      status: "new",
      conversationId: input.conversationId,
      createdAt: now,
      ...slaTimes(now, 0, pickRule(ctx.rules, match), ctx.cal),
    },
  });
}
```

Add imports for `loadSlaContext` from `./update`, `pickRule` from `@/lib/sla/rules` and `slaTimes` from `@/lib/sla/clock`. Keep the existing comment about no transaction.

- [ ] **Step 5: Existing writes go through saveTicket**

- `src/app/api/tickets/[id]/route.ts` PATCH: replace `const updated = await prisma.ticket.update({ where: { id }, data });` with `const updated = await saveTicket(ticket, data, { actorId: auth.userId });`. The sibling `updateMany` stays as it is; Task 9 makes it atomic.
- `src/app/api/tickets/[id]/messages/route.ts`: replace `await prisma.ticket.update({ where: { id }, data });` with `await saveTicket(ticket, data, { now });`.
- `src/lib/ai/tools.ts` `assignToPerson`: today it writes `status: "working"` directly. Change it to:

```ts
  const current = await prisma.ticket.findUnique({ where: { id: ticket.id } });
  if (current) {
    const data: Record<string, unknown> = { assignedToId: member.id };
    if (canMove(current.status, "working")) Object.assign(data, statusChange(current, "working"));
    await saveTicket(current, data);
  }
```

  Adapt the variable names to the surrounding code; import `canMove` and `statusChange` from `@/lib/tickets/status` and `saveTicket` from `@/lib/tickets/update`.
- Update the unit tests for these three files: mock `sLARule.findMany` to resolve `[]` and `businessHours.findUnique` to resolve `null`, and keep each test's intent.

- [ ] **Step 6: Integration test**

Create `tests/integration/sla-tickets.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { createTicket } from "@/lib/tickets/service";
import { saveTicket } from "@/lib/tickets/update";
import { statusChange } from "@/lib/tickets/status";

const A = "it-2b-sla";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "A", slug: A } });
  await asA(() =>
    prisma.sLARule.createMany({
      data: [
        { name: "default", firstResponseMins: 60, resolutionMins: 480 },
        { name: "urgent", priority: "urgent", firstResponseMins: 15, resolutionMins: 120 },
      ],
    })
  );
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
});

describe("sla on real tickets", () => {
  it("gets due times from the matching rule", async () => {
    const t = await asA(() => createTicket({ text: "printer down", priority: "urgent" }));
    expect(t.firstReplyDueAt!.getTime() - t.createdAt.getTime()).toBe(15 * 60_000);
    expect(t.resolveDueAt!.getTime() - t.createdAt.getTime()).toBe(120 * 60_000);
  });

  it("pauses while answered and moves the due time after", async () => {
    const t = await asA(() => createTicket({ text: "report empty" }));
    const answeredAt = new Date(t.createdAt.getTime() + 10 * 60_000);
    const answered = await asA(() => saveTicket(t, statusChange(t, "answered", answeredAt), { now: answeredAt }));
    expect(answered.slaPausedAt).toEqual(answeredAt);
    const back = new Date(answeredAt.getTime() + 60 * 60_000);
    const working = await asA(() => saveTicket(answered, statusChange(answered, "working", back), { now: back }));
    expect(working.slaPausedMins).toBe(60);
    expect(working.resolveDueAt!.getTime() - t.createdAt.getTime()).toBe((480 + 60) * 60_000);
  });
});
```

Run: `npm run test:integration`. Expected: all pass.

- [ ] **Step 7: Commit**

Run `npx tsc --noEmit`, `npx vitest run` and `npm run test:integration`. All must pass.

```bash
git add src tests
git commit -m "sla clocks on tickets, all ticket changes go through saveTicket"
```

---

### Task 4: Client replies, AI Suggested and archived follow-ups

**Files:**
- Modify: `src/lib/tickets/service.ts`, `src/lib/ai/engine.ts`, `tests/unit/ai-engine.test.ts`
- Create: `tests/integration/ticket-flow.test.ts`

**Interfaces:**
- Consumes: `saveTicket` (Task 3), `statusChange`, `canMove`
- Produces:
  - `ticketForIncomingMessage(conversationId, text)`: a client message on an `answered` or `ai_suggested` ticket moves it to `working`.
  - `chat()` marks a `new` ticket `ai_suggested` once a real AI reply is saved.
  - A follow-up ticket never lands in an archived project.

- [ ] **Step 1: Integration test first**

Create `tests/integration/ticket-flow.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { ticketForIncomingMessage } from "@/lib/tickets/service";
import { saveTicket } from "@/lib/tickets/update";
import { statusChange } from "@/lib/tickets/status";

const A = "it-2b-flow";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "A", slug: A } });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
});

describe("client messages", () => {
  it("move an answered ticket to staff working, without counting a reopen", async () => {
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "whatsapp" } }));
    const t = await asA(() => ticketForIncomingMessage(conv.id, "report kosong"));
    await asA(() => saveTicket(t, statusChange(t, "answered")));
    const after = await asA(() => ticketForIncomingMessage(conv.id, "masih kosong"));
    expect(after.id).toBe(t.id);
    expect(after.status).toBe("working");
    expect(after.reopenCount).toBe(0);
    expect(after.slaPausedAt).toBeNull();
  });

  it("leave other open statuses alone", async () => {
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "whatsapp" } }));
    const t = await asA(() => ticketForIncomingMessage(conv.id, "one"));
    const again = await asA(() => ticketForIncomingMessage(conv.id, "two"));
    expect(again.status).toBe("new");
    expect(again.id).toBe(t.id);
  });

  it("don't send a follow-up into an archived project", async () => {
    const archived = await asA(() => prisma.project.create({ data: { name: "Old client", archived: true } }));
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "whatsapp" } }));
    const first = await asA(() => ticketForIncomingMessage(conv.id, "one"));
    await asA(() => prisma.ticket.update({ where: { id: first.id }, data: { projectId: archived.id, status: "closed" } }));
    const next = await asA(() => ticketForIncomingMessage(conv.id, "two"));
    expect(next.projectId).not.toBe(archived.id);
  });
});
```

Run: `npm run test:integration`. Expected: FAIL on the first and third tests.

- [ ] **Step 2: Service changes**

In `src/lib/tickets/service.ts`:

Replace the open-ticket branch of `ticketForIncomingMessage` with:

```ts
  if (open) {
    // the client wrote back, so it needs staff again
    if (open.status === "answered" || open.status === "ai_suggested") {
      return saveTicket(open, statusChange(open, "working"));
    }
    return prisma.ticket.update({ where: { id: open.id }, data: { updatedAt: new Date() } });
  }
```

Replace `followUpProjectId` with:

```ts
// keep the thread in the project it was already in, unless that project is archived
async function followUpProjectId(conversationId: string, customerId: string | null): Promise<string | undefined> {
  const last = await prisma.ticket.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    select: { projectId: true, project: { select: { archived: true } } },
  });
  if (last && !last.project.archived) return last.projectId;
  if (!customerId) return undefined;
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { projectId: true, project: { select: { archived: true } } },
  });
  return customer?.projectId && !customer.project?.archived ? customer.projectId : undefined;
}
```

Import `saveTicket` from `./update` and `statusChange` from `./status`.

Run: `npm run test:integration`. Expected: PASS.

- [ ] **Step 3: AI Suggested**

In `src/lib/ai/engine.ts`, `callAI` returns a fixed apology string when the AI call fails: one in its error branch, and one in its `catch`. Change `callAI` to return `{ text: string; ok: boolean }`:
- `ok: true` on a real answer.
- `ok: false` on both fallback paths.
- Update every caller (check with `git grep -n "callAI(" src`) to use `.text`.

Then in `chat()`:
1. Keep the ticket: `const ticket = await ticketForIncomingMessage(conversationId, customerText);`.
2. After the assistant message is saved, add:

```ts
  // only a real ai answer counts as a suggestion
  if (reply.ok && ticket.status === "new") {
    await saveTicket(ticket, statusChange(ticket, "ai_suggested"));
  }
```

Here `reply` is the `callAI` result; save `reply.text` as the message content, as before.

Add these tests to `tests/unit/ai-engine.test.ts`:
- a successful AI reply on a `new` ticket calls `ticket.update` with `status: "ai_suggested"`;
- a failed AI call doesn't;
- a reply on a `working` ticket doesn't.

Mock `sLARule.findMany` to resolve `[]` and `businessHours.findUnique` to resolve `null`.

Run: `npx vitest run tests/unit/ai-engine.test.ts`. Expected: PASS.

- [ ] **Step 4: Commit**

Run `npx tsc --noEmit`, `npx vitest run` and `npm run test:integration`. All must pass.

```bash
git add src tests
git commit -m "client replies bring answered tickets back to staff, ai suggested status"
```

---

### Task 5: Email queue and staff alerts

**Files:**
- Create: `src/lib/notify/templates.ts`, `src/lib/notify/recipients.ts`, `src/lib/notify/outbox.ts`, `src/lib/notify/notify.ts`, `tests/unit/notify-templates.test.ts`, `tests/unit/notify-outbox.test.ts`, `tests/integration/notify.test.ts`
- Modify: `src/lib/tickets/service.ts` (openTicket), `src/lib/tickets/update.ts` (saveTicket), `src/lib/validations.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/admin/users/[id]/route.ts`, `src/app/(dashboard)/admin/page.tsx`, `tests/api/admin-users.test.ts`

**Interfaces:**
- Consumes: `EmailOutbox`, `Admin.email` and `Admin.notifyNew` (Task 1); `canSeeProject` (2A).
- Produces:
  - `type EmailKind = "new_ticket" | "reopened" | "sla_warning" | "sla_breach" | "close_warning"`
  - `buildEmail(kind: EmailKind, t: { id: string; number: number }, extra: { companyName: string; days?: number }): { subject: string; body: string }`
  - `recipientsFor(kind: Exclude<EmailKind, "close_warning">, t: { projectId: string; assigneeId: string | null }, actorId?: string): Promise<string[]>`
  - `queueEmail(e: { to: string; subject: string; body: string; kind: EmailKind; ticketId?: string | null }): Promise<void>`
  - `type Sender = (msg: { to: string; subject: string; text: string }) => Promise<void>`
  - `MAX_ATTEMPTS = 5`
  - `nextAttemptAt(attempts: number, now: Date): Date`
  - `drainOutbox(now?: Date, send?: Sender): Promise<{ sent: number; failed: number }>`
  - `notifyTicket(kind: Exclude<EmailKind, "close_warning">, t: Ticket, opts?: { actorId?: string }): Promise<void>`. It never throws.
  - `companyName(): Promise<string>`

- [ ] **Step 1: Templates, test first**

Create `tests/unit/notify-templates.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildEmail } from "@/lib/notify/templates";

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = "https://help.example.com/";
});

const t = { id: "t1", number: 42 };

describe("buildEmail", () => {
  it("staff emails carry a link and nothing else about the ticket", () => {
    const e = buildEmail("sla_breach", t, { companyName: "Acme" });
    expect(e.subject).toBe("Ticket #42 is overdue");
    expect(e.body).toContain("https://help.example.com/tickets/t1");
  });

  it("covers every staff kind", () => {
    for (const kind of ["new_ticket", "reopened", "sla_warning", "sla_breach"] as const) {
      expect(buildEmail(kind, t, { companyName: "Acme" }).body).toContain("/tickets/t1");
    }
  });

  it("the client warning has no link", () => {
    const e = buildEmail("close_warning", t, { companyName: "Acme", days: 3 });
    expect(e.subject).toBe("Your ticket #42 closes tomorrow");
    expect(e.body).not.toContain("http");
    expect(e.body).toContain("Acme");
  });
});
```

Create `src/lib/notify/templates.ts`:

```ts
export type EmailKind = "new_ticket" | "reopened" | "sla_warning" | "sla_breach" | "close_warning";

export function ticketLink(id: string): string {
  return `${(process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "")}/tickets/${id}`;
}

const STAFF: Record<Exclude<EmailKind, "close_warning">, (n: number) => [string, string]> = {
  new_ticket: (n) => [`New ticket #${n}`, `Ticket #${n} was opened.`],
  reopened: (n) => [`Ticket #${n} was reopened`, `Ticket #${n} was reopened and is back with you.`],
  sla_warning: (n) => [`Ticket #${n} is due soon`, `Ticket #${n} is close to its SLA time.`],
  sla_breach: (n) => [`Ticket #${n} is overdue`, `Ticket #${n} has passed its SLA time.`],
};

// link only: never ticket text, it may hold client details
export function buildEmail(
  kind: EmailKind,
  t: { id: string; number: number },
  extra: { companyName: string; days?: number }
): { subject: string; body: string } {
  if (kind === "close_warning") {
    return {
      subject: `Your ticket #${t.number} closes tomorrow`,
      body: [
        "Hi,",
        "",
        `We answered your ticket #${t.number}. If you still need help, reply to us the same way you contacted us before tomorrow. Otherwise the ticket will close.`,
        "",
        extra.companyName,
      ].join("\n"),
    };
  }
  const [subject, line] = STAFF[kind](t.number);
  return { subject, body: [line, "", `Open it: ${ticketLink(t.id)}`, "", extra.companyName].join("\n") };
}
```

Run the test. Expected: PASS.

- [ ] **Step 2: Outbox, test first**

Create `tests/unit/notify-outbox.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { drainOutbox, nextAttemptAt, MAX_ATTEMPTS } from "@/lib/notify/outbox";

const outbox = (prisma as unknown as { emailOutbox: Record<string, ReturnType<typeof vi.fn>> }).emailOutbox;
const now = new Date("2026-10-08T00:00:00Z");
const row = { id: "e1", to: "a@x.com", subject: "s", body: "b", attempts: 0 };

beforeEach(() => {
  for (const fn of Object.values(outbox)) fn.mockReset();
  outbox.findMany.mockResolvedValue([row]);
  outbox.update.mockResolvedValue({});
});

describe("drainOutbox", () => {
  it("marks sent emails", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    expect(await drainOutbox(now, send)).toEqual({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledWith({ to: "a@x.com", subject: "s", text: "b" });
    expect(outbox.update.mock.calls[0][0].data).toMatchObject({ status: "sent", sentAt: now });
  });

  it("retries later on failure", async () => {
    const send = vi.fn().mockRejectedValue(new Error("smtp down"));
    await drainOutbox(now, send);
    expect(outbox.update.mock.calls[0][0].data).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "smtp down",
      nextAttemptAt: nextAttemptAt(1, now),
    });
  });

  it("gives up after the last attempt", async () => {
    outbox.findMany.mockResolvedValue([{ ...row, attempts: MAX_ATTEMPTS - 1 }]);
    const send = vi.fn().mockRejectedValue(new Error("smtp down"));
    expect(await drainOutbox(now, send)).toEqual({ sent: 0, failed: 1 });
    expect(outbox.update.mock.calls[0][0].data).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
  });
});

describe("nextAttemptAt", () => {
  it("waits 2, 4, 8, 16 minutes", () => {
    expect(nextAttemptAt(1, now).getTime() - now.getTime()).toBe(2 * 60_000);
    expect(nextAttemptAt(4, now).getTime() - now.getTime()).toBe(16 * 60_000);
  });
});
```

Create `src/lib/notify/outbox.ts`:

```ts
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import type { EmailKind } from "./templates";

export const MAX_ATTEMPTS = 5;
const BATCH = 50;

export type Sender = (msg: { to: string; subject: string; text: string }) => Promise<void>;

export async function queueEmail(e: { to: string; subject: string; body: string; kind: EmailKind; ticketId?: string | null }) {
  await prisma.emailOutbox.create({
    data: { to: e.to, subject: e.subject, body: e.body, kind: e.kind, ticketId: e.ticketId ?? null },
  });
}

export function nextAttemptAt(attempts: number, now: Date): Date {
  return new Date(now.getTime() + 2 ** attempts * 60_000);
}

async function smtpSender(): Promise<Sender> {
  const s = await getSettings();
  if (!s.smtpHost) {
    return async () => {
      throw new Error("Email isn't set up in Settings");
    };
  }
  const transport = nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpPort === 465,
    auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPass } : undefined,
  });
  const from = s.smtpFrom || s.smtpUser;
  return async ({ to, subject, text }) => {
    await transport.sendMail({ from, to, subject, text });
  };
}

export async function drainOutbox(now = new Date(), send?: Sender): Promise<{ sent: number; failed: number }> {
  const rows = await prisma.emailOutbox.findMany({
    where: { status: "pending", nextAttemptAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  if (!rows.length) return { sent: 0, failed: 0 };
  const sender = send ?? (await smtpSender());
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await sender({ to: row.to, subject: row.subject, text: row.body });
      await prisma.emailOutbox.update({ where: { id: row.id }, data: { status: "sent", sentAt: now, lastError: "" } });
      sent++;
    } catch (error) {
      const attempts = row.attempts + 1;
      const gaveUp = attempts >= MAX_ATTEMPTS;
      if (gaveUp) failed++;
      await prisma.emailOutbox.update({
        where: { id: row.id },
        data: {
          status: gaveUp ? "failed" : "pending",
          attempts,
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          nextAttemptAt: nextAttemptAt(attempts, now),
        },
      });
    }
  }
  return { sent, failed };
}
```

Run the test. Expected: PASS.

- [ ] **Step 3: Recipients and notify**

Create `src/lib/notify/recipients.ts`:

```ts
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
```

Create `src/lib/notify/notify.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { buildEmail, type EmailKind } from "./templates";
import { recipientsFor } from "./recipients";
import { queueEmail } from "./outbox";

export async function companyName(): Promise<string> {
  const c = await prisma.company.findFirst({ select: { name: true } });
  return c?.name || "Help+";
}

// alerts must never break the request that caused them
export async function notifyTicket(
  kind: Exclude<EmailKind, "close_warning">,
  t: { id: string; number: number; projectId: string; assigneeId: string | null },
  opts: { actorId?: string } = {}
): Promise<void> {
  try {
    const to = await recipientsFor(kind, t, opts.actorId);
    if (!to.length) return;
    const email = buildEmail(kind, t, { companyName: await companyName() });
    for (const address of to) await queueEmail({ to: address, ...email, kind, ticketId: t.id });
  } catch (error) {
    logger.error(`couldn't queue ${kind} email`, error);
  }
}
```

- [ ] **Step 4: Hooks**

- In `openTicket` (`src/lib/tickets/service.ts`), keep the created ticket in `ticket`, then call `await notifyTicket("new_ticket", ticket);` and `return ticket;`.
- In `saveTicket` (`src/lib/tickets/update.ts`), after the update:

```ts
  if (data.status === "reopened" && before.status !== "reopened") {
    await notifyTicket("reopened", updated, { actorId: opts.actorId });
  }
  return updated;
```

  Here `updated` is the result of `db.ticket.update`.

Create `tests/integration/notify.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { createTicket } from "@/lib/tickets/service";
import { saveTicket } from "@/lib/tickets/update";
import { statusChange } from "@/lib/tickets/status";

const A = "it-2b-notify";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "Acme", slug: A } });
  await asA(() =>
    prisma.admin.createMany({
      data: [
        { id: "it-2b-boss", username: "it-2b-boss", password: "x", role: "admin", email: "boss@acme.test", notifyNew: true },
        { id: "it-2b-staff", username: "it-2b-staff", password: "x", role: "staff", email: "staff@acme.test", notifyNew: true },
      ],
    })
  );
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
});

describe("staff alerts", () => {
  it("queue new ticket emails only for people who can see the project", async () => {
    const t = await asA(() => createTicket({ text: "printer down" }));
    const emails = await asA(() => prisma.emailOutbox.findMany({ where: { ticketId: t.id } }));
    expect(emails.map((e) => e.to)).toEqual(["boss@acme.test"]);
    expect(emails[0].body).not.toContain("printer");
  });

  it("tell the assignee when someone else reopens", async () => {
    const t = await asA(() => createTicket({ text: "x" }));
    const assigned = await asA(() => prisma.ticket.update({ where: { id: t.id }, data: { assigneeId: "it-2b-boss" } }));
    const closed = await asA(() => saveTicket(assigned, statusChange(assigned, "closed")));
    await asA(() => saveTicket(closed, statusChange(closed, "reopened"), { actorId: "it-2b-staff" }));
    const emails = await asA(() => prisma.emailOutbox.findMany({ where: { ticketId: t.id, kind: "reopened" } }));
    expect(emails.map((e) => e.to)).toEqual(["boss@acme.test"]);
  });
});
```

Run: `npm run test:integration`. Expected: all pass. Usernames are unique across companies, so keep the `it-2b-` prefix.

- [ ] **Step 5: Users get an email address**

- `src/lib/validations.ts`:
  - In `createAdminSchema`, add `email: z.string().trim().email().or(z.literal("")).optional(),` and `notifyNew: z.boolean().optional(),`.
  - If there is an update schema for admins, add the same two fields to it.
- `src/app/api/admin/users/route.ts` and `[id]/route.ts`:
  - Read `email` and `notifyNew` from the body and save them, lowercasing the email.
  - Add `email: true, notifyNew: true` to every `select`.
  - Keep the existing owner rules.
- `src/app/(dashboard)/admin/page.tsx`: in the create and edit user form, add:
  - an "Email" input, `type="email"`, with the helper "For ticket alerts. Leave empty for none.";
  - a checkbox "Email me about new tickets", bound to `notifyNew`.

  Show the email in the user list under the name, using `text-helplus-text-light`.
- `tests/api/admin-users.test.ts`: add one test that POST stores a lowercased `email` and `notifyNew`, and one that a bad email gets 400.

- [ ] **Step 6: Commit**

Run `npx tsc --noEmit`, `npx vitest run`, `npm run test:integration` and `npm run lint`. All must pass.

```bash
git add src tests
git commit -m "email queue with retries and link-only staff alerts"
```

---

### Task 6: Worker: auto-close, SLA alerts, sending email

**Files:**
- Create: `src/lib/jobs/auto-close.ts`, `src/lib/jobs/sla-alerts.ts`, `src/lib/jobs/run.ts`, `scripts/worker.ts`, `tests/integration/jobs.test.ts`
- Modify: `package.json` (script), `src/lib/validations.ts` (`autoCloseDays` in `updateSettingsSchema`), `CHANGELOG.md`

**Interfaces:**
- Consumes: `saveTicket`, `loadSlaContext`, `slaWhere`, `notifyTicket`, `queueEmail`, `buildEmail`, `companyName`, `drainOutbox`, `getSettings`.
- Produces:
  - `runAutoClose(now: Date): Promise<{ closed: number; warned: number }>`
  - `runSlaAlerts(now: Date): Promise<{ warned: number; breached: number }>`
  - `runJobsForCompany(now: Date): Promise<void>`
  - `runAllCompanies(now?: Date): Promise<void>`
  - the `npm run worker` script, with `--once`

- [ ] **Step 1: Integration test first**

Create `tests/integration/jobs.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { createTicket } from "@/lib/tickets/service";
import { saveTicket } from "@/lib/tickets/update";
import { statusChange } from "@/lib/tickets/status";
import { runAutoClose } from "@/lib/jobs/auto-close";
import { runSlaAlerts } from "@/lib/jobs/sla-alerts";

const A = "it-2b-jobs";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);
const DAY = 86_400_000;

async function answeredTicket(daysAgo: number, customerEmail = "") {
  const t = await createTicket({ text: "x", customerContact: customerEmail });
  const at = new Date(Date.now() - daysAgo * DAY);
  return saveTicket(t, statusChange(t, "answered", at), { now: at });
}

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "Acme", slug: A } });
  await asA(() => prisma.settings.create({ data: { autoCloseDays: 3 } }));
  await asA(() =>
    prisma.admin.create({ data: { id: "it-2b-jobs-boss", username: "it-2b-jobs-boss", password: "x", role: "admin", email: "boss@acme.test" } })
  );
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
});

describe("auto-close", () => {
  it("closes answered tickets after the set days and leaves a note", async () => {
    const old = await asA(() => answeredTicket(4));
    const fresh = await asA(() => answeredTicket(1));
    await asA(() => runAutoClose(new Date()));
    const [a, b] = await asA(() => Promise.all([old, fresh].map((t) => prisma.ticket.findUniqueOrThrow({ where: { id: t.id } }))));
    expect(a.status).toBe("closed");
    expect(b.status).toBe("answered");
    const notes = await asA(() => prisma.internalNote.findMany({ where: { conversationId: a.conversationId! } }));
    expect(notes[0].content).toContain("3 days");
  });

  it("warns the client a day before when we have their email", async () => {
    const t = await asA(() => answeredTicket(2.5, "client@shop.test"));
    await asA(() => runAutoClose(new Date()));
    const emails = await asA(() => prisma.emailOutbox.findMany({ where: { ticketId: t.id, kind: "close_warning" } }));
    expect(emails.map((e) => e.to)).toEqual(["client@shop.test"]);
    const after = await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: t.id } }));
    expect(after.closeWarnedAt).not.toBeNull();
    await asA(() => runAutoClose(new Date()));
    expect(await asA(() => prisma.emailOutbox.count({ where: { ticketId: t.id, kind: "close_warning" } }))).toBe(1);
  });

  it("does nothing when the company closes tickets by hand", async () => {
    await asA(() => prisma.settings.updateMany({ data: { autoCloseDays: 0 } }));
    const t = await asA(() => answeredTicket(10));
    await asA(() => runAutoClose(new Date()));
    expect((await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: t.id } }))).status).toBe("answered");
    await asA(() => prisma.settings.updateMany({ data: { autoCloseDays: 3 } }));
  });
});

describe("sla alerts", () => {
  it("emails once when a ticket goes overdue", async () => {
    await asA(() => prisma.sLARule.create({ data: { name: "fast", firstResponseMins: 1, resolutionMins: 2 } }));
    const t = await asA(() => createTicket({ text: "x" }));
    const later = new Date(Date.now() + 10 * 60_000);
    await asA(() => runSlaAlerts(later));
    await asA(() => runSlaAlerts(later));
    const emails = await asA(() => prisma.emailOutbox.findMany({ where: { ticketId: t.id, kind: "sla_breach" } }));
    expect(emails.map((e) => e.to)).toEqual(["boss@acme.test"]);
    expect((await asA(() => prisma.ticket.findUniqueOrThrow({ where: { id: t.id } }))).slaBreachedAt).not.toBeNull();
  });
});
```

`createTicket({ customerContact })` stores the email on the conversation. The client email is found from `conversation.customer.email` first, then from `customerContact` when it looks like an email.

Run: `npm run test:integration`. Expected: FAIL, modules not found.

- [ ] **Step 2: Jobs**

Create `src/lib/jobs/auto-close.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { saveTicket, loadSlaContext } from "@/lib/tickets/update";
import { statusChange } from "@/lib/tickets/status";
import { buildEmail } from "@/lib/notify/templates";
import { queueEmail } from "@/lib/notify/outbox";
import { companyName } from "@/lib/notify/notify";

const DAY = 86_400_000;
const BATCH = 200;
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export async function runAutoClose(now: Date): Promise<{ closed: number; warned: number }> {
  const days = (await getSettings()).autoCloseDays;
  if (!days || days < 1) return { closed: 0, warned: 0 };

  const due = await prisma.ticket.findMany({
    where: { status: "answered", answeredAt: { lte: new Date(now.getTime() - days * DAY) } },
    take: BATCH,
  });
  const ctx = due.length ? await loadSlaContext() : undefined;
  for (const t of due) {
    await saveTicket(t, statusChange(t, "closed", now), { now, ctx });
    if (t.conversationId) {
      await prisma.internalNote.create({
        data: {
          conversationId: t.conversationId,
          content: `Closed automatically after ${days} day${days === 1 ? "" : "s"} with no reply from the client.`,
          authorName: "Help+",
        },
      });
    }
  }

  let warned = 0;
  if (days >= 2) {
    const soon = await prisma.ticket.findMany({
      where: { status: "answered", closeWarnedAt: null, answeredAt: { lte: new Date(now.getTime() - (days - 1) * DAY) } },
      include: { conversation: { select: { customerContact: true, customer: { select: { email: true } } } } },
      take: BATCH,
    });
    const name = soon.length ? await companyName() : "";
    for (const t of soon) {
      const contact = t.conversation?.customerContact ?? "";
      const to = t.conversation?.customer?.email || (looksLikeEmail(contact) ? contact : "");
      if (to) {
        await queueEmail({ to, ...buildEmail("close_warning", t, { companyName: name, days }), kind: "close_warning", ticketId: t.id });
        warned++;
      }
      await prisma.ticket.update({ where: { id: t.id }, data: { closeWarnedAt: now } });
    }
  }
  return { closed: due.length, warned };
}
```

Create `src/lib/jobs/sla-alerts.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { slaWhere } from "@/lib/sla/clock";
import { notifyTicket } from "@/lib/notify/notify";

const BATCH = 200;

export async function runSlaAlerts(now: Date): Promise<{ warned: number; breached: number }> {
  const breached = await prisma.ticket.findMany({ where: { AND: [slaWhere("breached", now), { slaBreachedAt: null }] }, take: BATCH });
  for (const t of breached) {
    await notifyTicket("sla_breach", t);
    await prisma.ticket.update({ where: { id: t.id }, data: { slaBreachedAt: now, slaWarnedAt: t.slaWarnedAt ?? now } });
  }
  const near = await prisma.ticket.findMany({ where: { AND: [slaWhere("near", now), { slaWarnedAt: null }] }, take: BATCH });
  for (const t of near) {
    await notifyTicket("sla_warning", t);
    await prisma.ticket.update({ where: { id: t.id }, data: { slaWarnedAt: now } });
  }
  return { warned: near.length, breached: breached.length };
}
```

Create `src/lib/jobs/run.ts`:

```ts
import { systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { logger } from "@/lib/logger";
import { drainOutbox } from "@/lib/notify/outbox";
import { runAutoClose } from "./auto-close";
import { runSlaAlerts } from "./sla-alerts";

const JOBS: [string, (now: Date) => Promise<unknown>][] = [
  ["auto-close", runAutoClose],
  ["sla alerts", runSlaAlerts],
  ["email", (now) => drainOutbox(now)],
];

// one failing job shouldn't stop the others
export async function runJobsForCompany(now: Date): Promise<void> {
  for (const [name, job] of JOBS) {
    try {
      await job(now);
    } catch (error) {
      logger.error(`job ${name} failed`, error);
    }
  }
}

export async function runAllCompanies(now = new Date()): Promise<void> {
  const companies = await systemPrisma.company.findMany({ select: { id: true } });
  for (const c of companies) await runWithCompany(c.id, () => runJobsForCompany(now));
}
```

Run: `npm run test:integration`. Expected: PASS.

- [ ] **Step 3: Worker script**

Create `scripts/worker.ts`:

```ts
// background jobs: auto-close, sla alerts, email. run next to the app with npm run worker
import { runAllCompanies } from "../src/lib/jobs/run";
import { systemPrisma } from "../src/lib/prisma";
import { logger } from "../src/lib/logger";

const EVERY_MS = 60_000;
let stopping = false;
const stop = () => {
  stopping = true;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function main() {
  const once = process.argv.includes("--once");
  logger.info(once ? "worker: one run" : "worker: started");
  do {
    const started = Date.now();
    try {
      await runAllCompanies(new Date());
    } catch (error) {
      logger.error("worker run failed", error);
    }
    if (once) break;
    const wait = Math.max(0, EVERY_MS - (Date.now() - started));
    for (let waited = 0; waited < wait && !stopping; waited += 1000) await new Promise((r) => setTimeout(r, 1000));
  } while (!stopping);
  await systemPrisma.$disconnect();
}

main();
```

Add `"worker": "tsx --env-file=.env scripts/worker.ts",` to the `scripts` in `package.json`.

Check `logger.info` exists in `src/lib/logger.ts`. If it doesn't, use `logger.warn`.

Run: `npm run worker -- --once`. Expected: it logs "worker: one run" and exits with code 0. Then check the dev db:

```bash
PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/psql.exe -h localhost -U helpplus -d helpplus -tAc 'select status, count(*) from "EmailOutbox" group by status'
```

Any pending emails stay pending or fail with "Email isn't set up in Settings" when SMTP isn't configured. That's expected locally.

- [ ] **Step 4: Settings accept autoCloseDays**

In `updateSettingsSchema` in `src/lib/validations.ts`, add `autoCloseDays: z.number().int().min(0).max(60).optional(),`. Check that `PUT /api/settings` and `saveSettings` pass it through, the same way `projectLabel` went through in 2A.

- [ ] **Step 5: Changelog**

In `CHANGELOG.md`, under `[Unreleased]` > `### Changed`, add:
- "SLA rules per company with project, priority, category and source overrides. Due times follow business hours and holidays and pause while a ticket waits on the client."
- "Answered tickets close by themselves after 3 days by default (Settings > Closing tickets). Clients with an email get a warning a day before."
- "Link-only email alerts for new, reopened, near-breach and overdue tickets, with retries and an email log."

Under `### Upgrade notes`, add:
- "Run the worker next to the app: `npm run worker`. Without it, nothing closes by itself and no emails go out."
- "Add an email address to each user who should get alerts (Users & roles)."
- "SLA times apply to tickets created after the upgrade, and to older tickets once their priority, project, category or source changes."

- [ ] **Step 6: Commit**

Run `npx tsc --noEmit`, `npx vitest run`, `npm run test:integration` and `npm run lint`. All must pass.

```bash
git add src tests scripts package.json CHANGELOG.md
git commit -m "worker for auto-close, sla alerts and email"
```

---

### Task 7: Settings screens: SLA rules, holidays, closing tickets, email log

**Files:**
- Rewrite: `src/app/(dashboard)/sla/page.tsx`
- Create:
  - `src/app/api/holidays/route.ts`, `src/app/api/holidays/[id]/route.ts`
  - `src/components/settings/holidays-card.tsx`
  - `src/app/(dashboard)/closing/page.tsx`
  - `src/app/api/email-outbox/route.ts`, `src/app/api/email-outbox/[id]/retry/route.ts`
  - `src/app/(dashboard)/email-log/page.tsx`
  - `tests/api/holidays.test.ts`, `tests/api/email-outbox.test.ts`
- Modify: `src/app/(dashboard)/business-hours/page.tsx` (render `<HolidaysCard />`), `src/components/layout/nav-items.ts`, `tests/unit/nav-items.test.ts`, `scripts/smoke-pages.mjs`

**Interfaces:**
- Consumes: the SLA API (Task 1), `PUT /api/settings` with `autoCloseDays` (Task 6), `GET /api/projects`.
- Produces (HTTP):
  - `GET /api/holidays` returns `{ data: Holiday[] }`, sorted by date. Needs `business-hours:read`.
  - `POST /api/holidays` takes `{ date, name? }` and returns 201. A duplicate date returns 409. Needs `business-hours:update`.
  - `DELETE /api/holidays/:id`. Needs `business-hours:update`.
  - `GET /api/email-outbox?status=failed|pending|sent|all` returns a paginated list. Needs `emails:manage`.
  - `POST /api/email-outbox/:id/retry` sets status pending, attempts 0 and nextAttemptAt now. Needs `emails:manage`.

- [ ] **Step 1: API tests first**

Create `tests/api/holidays.test.ts`. Use the same `asRole` and `createRequest` helpers as `tests/api/projects.test.ts`, and cover these cases:
- `GET` asks `requireAuth` for `"business-hours:read"` and returns the rows ordered by date (`orderBy: { date: "asc" }`).
- `POST` asks for `"business-hours:update"`, rejects `{ date: "25-12-2026" }` with 400, and creates `{ date: "2026-12-25", name: "Christmas" }`.
- `POST` returns 409 when `holiday.create` rejects with `code: "P2002"`.
- `DELETE` returns 404 when `holiday.findUnique` resolves null.

Create `tests/api/email-outbox.test.ts` with these cases:
- `GET` asks for `"emails:manage"`.
- `?status=failed` filters `{ status: "failed" }`.
- The retry route sets `{ status: "pending", attempts: 0 }`.
- Retry on a row that is already sent returns 409.

Run them. Expected: FAIL.

- [ ] **Step 2: Holidays API**

Create `src/app/api/holidays/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { validateBody } from "@/lib/validations";

const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  name: z.string().trim().max(100).optional(),
});

export const GET = withAuth("business-hours:read", async () => {
  const data = await prisma.holiday.findMany({ orderBy: { date: "asc" } });
  return NextResponse.json({ data });
});

export const POST = withAuth("business-hours:update", async (request: NextRequest) => {
  const validation = validateBody(holidaySchema, await request.json());
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
  try {
    const holiday = await prisma.holiday.create({ data: { date: validation.data.date, name: validation.data.name ?? "" } });
    return NextResponse.json(holiday, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "That date is already a holiday" }, { status: 409 });
    }
    throw error;
  }
});
```

Create `src/app/api/holidays/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withAuth("business-hours:update", async (_request: NextRequest, _auth, { params }: Ctx) => {
  const { id } = await params;
  if (!(await prisma.holiday.findUnique({ where: { id } }))) {
    return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
  }
  await prisma.holiday.delete({ where: { id } });
  return NextResponse.json({ success: true });
});
```

- [ ] **Step 3: Email log API**

Create `src/app/api/email-outbox/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";
import { parsePagination, paginatedResponse } from "@/lib/pagination";

const STATUSES = new Set(["pending", "sent", "failed"]);

export const GET = withAuth("emails:manage", async (request: NextRequest) => {
  const params = request.nextUrl.searchParams;
  const { page, limit, skip, take } = parsePagination(params);
  const status = params.get("status") ?? "all";
  const where = STATUSES.has(status) ? { status } : {};
  const [rows, total] = await Promise.all([
    prisma.emailOutbox.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: {
        id: true,
        to: true,
        subject: true,
        kind: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        sentAt: true,
        ticketId: true,
      },
    }),
    prisma.emailOutbox.count({ where }),
  ]);
  return NextResponse.json(paginatedResponse(rows, total, page, limit));
});
```

Create `src/app/api/email-outbox/[id]/retry/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/tenant/with-auth";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withAuth("emails:manage", async (_request: NextRequest, _auth, { params }: Ctx) => {
  const { id } = await params;
  const row = await prisma.emailOutbox.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: "Email not found" }, { status: 404 });
  if (row.status === "sent") return NextResponse.json({ error: "Already sent" }, { status: 409 });
  const updated = await prisma.emailOutbox.update({
    where: { id },
    data: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: "" },
  });
  return NextResponse.json(updated);
});
```

Run the two API tests and `tests/unit/route-guard.test.ts`. Expected: PASS.

- [ ] **Step 4: Screens**

All screens use `Header`, the `helplus-*` tokens, and visible errors with disabled buttons while saving, the same pattern as the 2A projects pages. They must work at 390px.

**`src/components/settings/holidays-card.tsx`:**
- A card titled "Holidays", with the helper "Days off on top of the weekly hours. They only count while business hours are on."
- A list of `date · name`, each with a delete button (lucide `Trash2`, `aria-label="Remove holiday"`).
- A form with an `<input type="date">`, a name input and an "Add" button.
- Uses `GET`, `POST` and `DELETE /api/holidays`. Shows the server error on 409 or 400.

**`src/app/(dashboard)/business-hours/page.tsx`:** render `<HolidaysCard />` below the weekly hours card. Change nothing else.

**`src/app/(dashboard)/sla/page.tsx` (full rewrite):**
- Header: "SLA rules", with the description "How fast tickets should get a first reply and be solved".
- List, desktop table and phone cards. Columns:
  - Name
  - Applies to: chips for project name (or "All clients"), priority, category, source, each only when not "all"
  - First reply
  - Solve within
  - Active (toggle)
  - Edit and Delete
- Show minutes as `formatMins(m)`: `< 60` → `"45m"`; otherwise `"2h"`, or `"2h 30m"` when there are leftover minutes. Put `formatMins` in `src/lib/sla/format.ts` with a unit test in `tests/unit/sla-format.test.ts`, covering 45, 60, 150 and 1440 → "24h".
- The add and edit form is a modal or bottom sheet on phones, with these fields:
  - name
  - project: a select from `GET /api/projects` with "All clients" first
  - priority: all, low, medium, high, urgent
  - category: free text, empty means all
  - source: all, whatsapp, email, phone, sms, telegram, web_form, quick_add
  - first reply: number plus a minutes/hours unit select
  - solve within: number plus a unit select
  - active

  Send minutes to the API.
- A note under the list: "Most specific rule wins: client, then priority, category, source. Changes apply to new tickets and to tickets whose details change."
- When there are no rules, show the empty state "No SLA rules yet. Add one to start timing tickets."

**`src/app/(dashboard)/closing/page.tsx`:**
- Header: "Closing tickets".
- One card containing:
  - The select "Close answered tickets automatically", with options Off (staff close only) = 0, then 1, 2, 3, 5, 7 and 14 days.
  - Text below the select: "Clients with an email get a warning a day before. Tickets close only if the client hasn't replied. A reply sends the ticket back to staff."
  - A "Save" button.
- Data: read `autoCloseDays` from `GET /api/settings`, and save with `PUT /api/settings { autoCloseDays }`.
- Show "Saved" or the error.

**`src/app/(dashboard)/email-log/page.tsx`:**
- Header: "Email log", with the description "Alerts sent by the worker. Failed emails retry 5 times."
- Filter chips: Failed (default), Pending, Sent, All.
- Each row shows the subject, `to`, kind, status (dot plus text: failed uses the danger tone, pending warning, sent success), attempts, the time, and `lastError` in `text-helplus-danger` for failed rows.
- Failed and pending rows get a "Retry" button.
- Show a "Worker not running?" hint when there are pending rows older than 10 minutes.
- Paginated like the tickets page.

**`src/components/layout/nav-items.ts`:**
- In the "Settings" section group, add `{ name: "Closing tickets", href: "/closing" }` after "SLA rules", and `{ name: "Email log", href: "/email-log" }` after "Integrations".
- Update `tests/unit/nav-items.test.ts` if it lists the Settings items.

**`scripts/smoke-pages.mjs`:** add `"/closing"` and `"/email-log"` to `PAGES`.

- [ ] **Step 5: Check and commit**

Run:
- `npx tsc --noEmit`
- `npx vitest run`
- `npm run test:integration`
- `npm run lint`: expect 0 errors.
- `npm run smoke`: expect no runtime errors.

Then check by hand with puppeteer as admin (admin/admin123), saving screenshots to `.superpowers/screens-2b/` at 1280 and 390 wide:
- `/sla`: add a rule "Urgent", priority urgent, 15m first reply, 2h solve. Check it lists as "15m" and "2h". Edit it, then delete it.
- `/business-hours`: add a holiday, see it listed, then remove it.
- `/closing`: set 5 days, save, and reload to check it stays at 5. Then set it back to 3.
- `/email-log`: shows the empty state, or rows from the worker run.

Clean up any test data afterwards.

```bash
git add src tests scripts
git commit -m "settings for sla rules, holidays, closing tickets and the email log"
```

---

### Task 8: SLA in the inbox and on the ticket

**Files:**
- Create: `src/components/tickets/sla-badge.tsx`, `tests/unit/sla-badge.test.ts`
- Modify:
  - `src/app/api/tickets/route.ts` (the `sla` filter and `slaCounts`)
  - `tests/api/tickets.test.ts`
  - `src/app/api/company/route.ts` (`autoCloseDays`) and its test in `tests/api/projects.test.ts`
  - `src/lib/hooks/use-company.ts`
  - `src/components/tickets/ticket-list.tsx`
  - `src/app/(dashboard)/tickets/page.tsx`
  - `src/app/(dashboard)/tickets/[id]/page.tsx`

**Interfaces:**
- Consumes: `slaState` and `slaWhere` (Task 3).
- Produces:
  - `GET /api/tickets?sla=near|breached` and `slaCounts: { near: number; breached: number }` in the list response.
  - `GET /api/company` adds `autoCloseDays`.
  - `slaLabel(state): { text: string; tone: string } | null` and `<SlaBadge ticket={...} />`.
  - `closesOn(answeredAt: string | null, days: number): Date | null`.

- [ ] **Step 1: Helpers, test first**

Create `tests/unit/sla-badge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { slaLabel, closesOn } from "@/components/tickets/sla-badge";

describe("slaLabel", () => {
  it("only shows the states staff act on", () => {
    expect(slaLabel("near")?.text).toBe("Due soon");
    expect(slaLabel("breached")?.text).toBe("Overdue");
    expect(slaLabel("paused")?.text).toBe("Waiting on client");
    expect(slaLabel("ok")).toBeNull();
    expect(slaLabel("none")).toBeNull();
  });
});

describe("closesOn", () => {
  it("adds the days to the answer time", () => {
    expect(closesOn("2026-10-05T00:00:00Z", 3)).toEqual(new Date("2026-10-08T00:00:00Z"));
  });
  it("is null when auto-close is off or the ticket isn't answered", () => {
    expect(closesOn("2026-10-05T00:00:00Z", 0)).toBeNull();
    expect(closesOn(null, 3)).toBeNull();
  });
});
```

Create `src/components/tickets/sla-badge.tsx`:

```tsx
import { slaState, type SlaState, type SlaTicket } from "@/lib/sla/clock";

const LABELS: Partial<Record<SlaState, { text: string; tone: string }>> = {
  near: { text: "Due soon", tone: "#F79009" },
  breached: { text: "Overdue", tone: "#D92D20" },
  paused: { text: "Waiting on client", tone: "#98A2B3" },
};

export function slaLabel(state: SlaState): { text: string; tone: string } | null {
  return LABELS[state] ?? null;
}

export function closesOn(answeredAt: string | null, days: number): Date | null {
  if (!answeredAt || days < 1) return null;
  return new Date(new Date(answeredAt).getTime() + days * 86_400_000);
}

type Dates = Record<keyof Omit<SlaTicket, "status">, string | null>;

export function toSlaTicket(t: { status: string } & Dates): SlaTicket {
  const d = (v: string | null) => (v ? new Date(v) : null);
  return {
    status: t.status,
    firstReplyAt: d(t.firstReplyAt),
    closedAt: d(t.closedAt),
    slaPausedAt: d(t.slaPausedAt),
    firstReplyWarnAt: d(t.firstReplyWarnAt),
    firstReplyDueAt: d(t.firstReplyDueAt),
    resolveWarnAt: d(t.resolveWarnAt),
    resolveDueAt: d(t.resolveDueAt),
  };
}

export function SlaBadge({ ticket, showPaused = false }: { ticket: { status: string } & Dates; showPaused?: boolean }) {
  const state = slaState(toSlaTicket(ticket), new Date());
  const label = slaLabel(state);
  if (!label || (state === "paused" && !showPaused)) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-helplus-text whitespace-nowrap">
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: label.tone }} />
      {label.text}
    </span>
  );
}
```

Run the test. Expected: PASS.

- [ ] **Step 2: API**

`src/app/api/tickets/route.ts`:
- Read `sla` from the params. When it is `near` or `breached`, push `slaWhere(sla, now)` into `filters` (the list where).
- Add `slaCounts`, computed within `countWhere`'s project scope and ignoring status:

```ts
    const now = new Date();
    const [near, breached] = await Promise.all([
      prisma.ticket.count({ where: { AND: [...filters, slaWhere("near", now)] } }),
      prisma.ticket.count({ where: { AND: [...filters, slaWhere("breached", now)] } }),
    ]);
```

  Return `slaCounts: { near, breached }` next to `counts`.

  Compute `slaCounts` before you push the `sla` filter into `filters`. Otherwise an active `sla` filter changes its own count.
- Add tests in `tests/api/tickets.test.ts`:
  - `sla=breached` adds a where containing `"slaPausedAt":null`;
  - the response has `slaCounts`.

`src/app/api/company/route.ts`: add `autoCloseDays: settings.autoCloseDays` to the response. In `use-company.ts`, add `autoCloseDays: number` with `0` in the empty fallback. Update the company test.

- [ ] **Step 3: Inbox and ticket page**

`src/components/tickets/ticket-list.tsx`:
- Add the SLA date fields (`firstReplyAt`, `closedAt`, `slaPausedAt`, `firstReplyWarnAt`, `firstReplyDueAt`, `resolveWarnAt`, `resolveDueAt`, all `string | null`) to `TicketRow`.
- Render `<SlaBadge ticket={t} />` after the `StatusDot`, in both the table status cell and the phone card.

`src/app/(dashboard)/tickets/page.tsx`:
- Add two chips after "Unassigned": `{ key: "breached", label: "Overdue", status: "open", sla: "breached" }` and `{ key: "near", label: "Due soon", status: "open", sla: "near" }`.
- Pass `sla` to the API when it is set.
- Their counts come from `slaCounts`.

`src/app/(dashboard)/tickets/[id]/page.tsx`: in the side panel under Status, add an "SLA" block:
- `<SlaBadge ticket={ticket} showPaused />`.
- "First reply by <time>" when `firstReplyDueAt` is set and `firstReplyAt` is null.
- "Solve by <time>" when `resolveDueAt` is set and the ticket isn't closed.
- Use `toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })`.
- When nothing is set, show "No SLA rule".
- When the ticket is `answered` and `useCompany().autoCloseDays > 0`, show "Closes <date> if the client doesn't reply" using `closesOn`. If that date is within 24 hours, use "Closes tomorrow" in `text-helplus-warning`.

- [ ] **Step 4: Check and commit**

Run `npx tsc --noEmit`, `npx vitest run`, `npm run test:integration`, `npm run lint` and `npm run smoke`.

Then check the flow with puppeteer as admin, saving screenshots at 1280 and 390 to `.superpowers/screens-2b/`:
1. Create an SLA rule with a 1 minute first reply and 2 minute solve, then quick add a ticket.
2. Wait about 1 minute, reload `/tickets`, and check "Overdue" shows on the row and in the chip count.
3. Open the ticket and check the SLA block.
4. Reply with "Copy and mark answered" and check the block shows "Waiting on client" and "Closes …".
5. Delete the test rule and test ticket afterwards. Delete the conversation; its tickets cascade.

```bash
git add src tests
git commit -m "due soon and overdue in the inbox, sla and closing date on the ticket"
```

---

### Task 9: Close the 2A leftovers

**Files:**
- Modify:
  - `src/lib/tickets/access.ts` (`customerWhere`)
  - `src/app/api/customers/route.ts`, `src/app/api/customers/[id]/route.ts`, `src/app/api/customers/[id]/notes/route.ts` (and `gdpr` if staff can reach it)
  - `src/app/api/conversations/route.ts` (POST)
  - `src/app/api/stats/route.ts`
  - `src/app/api/tickets/[id]/route.ts` (atomic project move)
  - `src/app/(dashboard)/tickets/[id]/page.tsx` (refresh error)
- Test: `tests/api/customers-scope.test.ts`, `tests/integration/customers-scope.test.ts`, plus additions to `tests/api/conversations.test.ts`, `tests/api/stats.test.ts` and `tests/api/ticket-detail.test.ts`

**Interfaces:**
- Produces: `customerWhere(ids: string[] | null): Record<string, unknown>`

- [ ] **Step 1: People follow project access**

Add to `src/lib/tickets/access.ts`:

```ts
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
```

Apply it everywhere customers are read:
- `GET /api/customers`: AND it with the existing filters in both `findMany` and `count`. The existing `where.OR` for search must become `AND: [{ OR: search }, customerWhere(...)]`, so the two ORs don't collide.
- `GET`, `PUT` and `DELETE /api/customers/[id]`: return 404 when the customer isn't visible. Use `findFirst({ where: { id, ...customerWhere(ids) } })`.
- `/api/customers/[id]/notes`: check visibility the same way.
- `/api/customers/[id]/gdpr`: if its permission lets staff or viewers in, check visibility the same way. Otherwise leave it.
- `POST /api/customers` stays as it is, since creating a person reveals nothing.

Tests:
- Unit tests that a staff user limited to p1 gets 404 on a customer outside, and a filtered list.
- One integration test in `tests/integration/customers-scope.test.ts` with real rows:
  - a customer with `projectId` p1;
  - a customer with a ticket in p1 but no projectId;
  - a customer in p2.

  Staff with access to p1 see exactly the first two. Check this through the real `prisma.customer.findMany({ where: customerWhere(["p1"]) })` inside `runWithCompany`.

- [ ] **Step 2: Lock the old create-conversation route**

In `POST /api/conversations`, add at the top of the handler:

```ts
    // limited users can't create a thread outside their projects
    if ((await allowedProjectIds(auth)) !== null) {
      return NextResponse.json({ error: "Use quick add on the Tickets page" }, { status: 403 });
    }
```

Add a test to `tests/api/conversations.test.ts`: staff get 403 and admins still create.

- [ ] **Step 3: Stats match the dashboard**

In `src/app/api/stats/route.ts`, scope the conversation and message totals too:
- conversations: `conversationWhere(ids)`, ANDed with the existing status filters;
- messages: `{ conversation: conversationWhere(ids) }`.

Use the same `ids = await allowedProjectIds(auth)` call that already scopes tickets. Add a test that staff totals are filtered.

- [ ] **Step 4: Moving a ticket is all or nothing**

In the PATCH of `src/app/api/tickets/[id]/route.ts`, when `projectId` changes and the ticket has a `conversationId`, wrap both writes:

```ts
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await saveTicket(ticket, data, { actorId: auth.userId, db: tx });
      if (projectId !== undefined && ticket.conversationId) {
        await tx.ticket.updateMany({ where: { conversationId: ticket.conversationId, id: { not: id } }, data: { projectId } });
      }
      return saved;
    });
```

Load the SLA context before the transaction and pass it in as `ctx`, so `saveTicket` doesn't query inside it. The reopened email (Task 5) queues through `prisma`, outside the transaction. That's acceptable: worst case, one extra email.

If the scoped client's interactive transaction doesn't accept `tx` for `saveTicket`'s `db` option, type it as `Pick<typeof prisma, "ticket">`.

Update the unit tests: mock `$transaction` the way `tests/api/projects.test.ts` does (`db.$transaction.mockImplementation(async (fn) => fn(db))`).

- [ ] **Step 5: Ticket page shows refresh failures**

In `src/app/(dashboard)/tickets/[id]/page.tsx`, when a reload fails while a ticket is already shown, show an inline line above the messages: "Couldn't refresh. Showing what was loaded before." with a "Retry" button, in `text-helplus-danger`. Clear it on the next successful load.

- [ ] **Step 6: Check and commit**

Run `npx tsc --noEmit`, `npx vitest run`, `npm run test:integration`, `npm run lint` and `npm run smoke`.

Finally, stop the dev server and run `npx next build`, which must succeed. Then restart the dev server.

```bash
git add src tests
git commit -m "people, stats and new conversations follow project access, atomic project move"
```

---

## Done when

- All of these pass: `npx vitest run`, `npm run test:integration`, `npx tsc --noEmit`, `npm run lint` (0 errors), `npm run smoke` and `npx next build`.
- New tickets get first reply and solve due times from the most specific active rule. The times follow business hours, holidays and the company time zone, and resolution pauses while a ticket is Answered.
- The inbox shows Due soon and Overdue with chip counts, and the ticket shows its due times and close date.
- A client message on an Answered or AI Suggested ticket moves it to Staff working. A real AI reply on a New ticket marks it AI Suggested.
- `npm run worker` closes Answered tickets after the company's days, with a note. It warns clients with an email a day before, emails staff on near-breach and breach (once each), and sends queued email with retries. Failures show in Settings > Email log.
- Staff emails are link only. Users can opt in to new-ticket emails.
- Settings has SLA rules (project, priority, category and source), holidays, Closing tickets and the Email log.
- Limited staff only see people, stats and conversations from their projects, and moving a ticket's project is atomic.

Not in this plan:
- Client-facing "staff reply" and "closed" emails, and links for clients (stage 5).
- A project-aware realtime stream (no UI uses it yet).
- Reports on SLA met % (stage 6).
- Running the worker in production containers (deployment).
