# Stage 3B: WhatsApp Export and Old-System Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can import past support history in two ways:
- a WhatsApp chat export (`.txt` or `.zip` with media), turned into tickets per issue;
- a CSV export from the old system, turned into closed tickets with their answers.

In both cases IC numbers are hidden, and every question with an answer becomes a Library draft waiting for approval.

**Architecture:**
- **Pure modules** do the hard parts:
  - `src/lib/imports/whatsapp/parse.ts` turns chat text into messages (Android and iPhone formats, date order, 12/24h).
  - `group.ts` splits messages into issues by fixed rules.
  - `src/lib/imports/csv/*` maps and validates rows.
- **The import itself:**
  - Upload stores the file encrypted.
  - A preview step lets staff confirm senders, date order and column mapping.
  - A worker job creates tickets in batches, using `src/lib/imports/write.ts` (no SLA, no alert emails).
- **Re-imports** skip anything already seen, using unique `importKey` values on tickets and messages.
- **Images from a `.zip`** become 3A screenshots (pending), which the worker IC-checks a few at a time.
- **AI**, when configured, only writes titles and categories and merges obvious split pieces. Without AI the import still works.

**Tech Stack:** Next.js 16 route handlers, Prisma 7 (tenant extension), `fflate` (unzip, with size limits), `papaparse` (CSV), the 3A attachments pipeline, Vitest.

Spec: `docs/specs/2026-10-04-helplus-design.md`, section "3. Intake", parts "WhatsApp chat export" and "Old system import". The silent bot is stage 3C.

## Global Constraints

- **Naming.** Code name `helplus`, display name "Help+". No "owly" anywhere except `LICENSE`.
- **Comments.** Only when needed. One short plain line, written the way a person would. No multi-line explanations, no emoji.
- **Commits.** Short, lowercase messages with no Co-Authored-By trailer. Commit locally by explicit path; never push or open a PR.
- **Before every commit:** `npx vitest run`, `npx tsc --noEmit` and `npm run test:integration` all pass. A UI task's last commit also passes `npm run lint` (0 errors) and `npm run smoke`.
- **Look.**
  - Indigo `#3B3FA6`, warm greys, IBM Plex, lucide icons, no emoji.
  - Text colours only `text-helplus-{text,text-light,link,danger,success,warning}`, plus `text-white` on primary buttons.
  - Every screen works at 390px.
- **Data access.**
  - Every query goes through the scoped `prisma`. `systemPrisma` is only for looping over companies in the worker.
  - Writes use scalar foreign keys, never `connect`. The link check runs outside transactions.
- **Privacy.**
  - Every stored text from an import is IC-masked with `maskIC`: messages, titles, descriptions, Library drafts, customer names and file names.
  - Uploaded import files are stored encrypted (`encryptBuffer`) and deleted when the import finishes.
- **Imports never send emails.** No new-ticket or SLA alerts, and imported tickets get no SLA times.
- **Library drafts never reach the AI until approved.** Drafts are saved with `isActive: false`, and every AI knowledge query already filters `isActive: true`.
- **Local databases.**
  - Dev db `helpplus`, test db `helpplus_test`, user `helpplus`, password `helpplus_dev_2026`.
  - psql and pg_dump are in `/c/ServBay/packages/postgresql/18/bin/`.
- **Dev server** runs on :3000.
  - Stop it before `prisma generate` or `next build`, using PowerShell: `Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess -Force -Confirm:$false`.
  - Restart it with `cd /d/development/helpdeskAI2 && (nohup npm run dev > ../helpdeskAI2-dev.log 2>&1 &)`.
- **Logins** are rate limited to 5 per minute per IP. Puppeteer scripts log in once.

---

## Decisions this plan makes

User decisions (2026-10-09):
- Fixed rules split chats into issues. AI, when set up, only writes titles and categories and merges obvious split pieces.
- Images from `.zip` exports are imported and IC-checked by the worker. Videos, voice notes and documents are skipped and counted.
- The old system import accepts CSV only.

Plan decisions:

**Upload limits**
- The upload limit is 50 MB, which fits inside the 52 MB proxy limit from 3A.
- Larger WhatsApp exports: export "without media" or in parts. The screen says so.

**Zip safety**
- At most 5000 entries.
- At most 500 MB uncompressed in total.
- At most 10 MB per image.
- Entries are matched only by base name, never written to disk by path.

**Date order**
- Detected per file. If any first number is above 12, the order is day/month. If any second number is above 12, it's month/day. Otherwise it defaults to day/month (Malaysia).
- Staff can switch the order in the preview.

**Staff senders**
- Senders are matched against Settings > Team (`TeamMember` name or phone) and user names (`Admin.name`).
- The preview lists every sender with a "Staff" tick, prefilled from that match.
- Choices are remembered per company in `ChatSender`.

**Splitting a chat into issues (`group.ts`)**
- Client messages start a new issue when:
  - there's no open issue;
  - the current issue already has a staff reply and the gap since the last message is 30 minutes or more;
  - or the gap is 4 hours or more.
- Staff messages join the current issue. A staff message with no open issue is skipped and counted as an announcement.
- System lines are skipped: "Messages and calls are end-to-end encrypted", "X added Y", and similar.

**Status and dates of imported tickets**
- A ticket with at least one staff reply is closed. Its `answeredAt` and `firstReplyAt` are the first staff reply, and its `closedAt` is its last message.
- A ticket without a staff reply is `new` if its last message is within 14 days of the newest message in the export. Otherwise it's closed with the note "No reply in the imported chat".

**Customers and conversations**
- One conversation per ticket, with channel `whatsapp`. The ticket `source` is `whatsapp_export`.
- The customer is found or created by sender: by phone when the sender is a number, otherwise by name.
- The customer is linked to the chosen project.

**Re-imports**
- Each message's `importKey` is `wa:` plus the sha256 of project id, ISO minute, sender and text.
- Each ticket's `importKey` is `wa:` plus the sha256 of its first message key.
- Overlapping exports skip known messages. A known first message means the issue is skipped.
- CSV tickets use `csv:<oldId>`.

**CSV mapping**
- Columns map to these fields:
  - old ID (required);
  - question (required);
  - answer, title, client name, client contact, created date, closed date, category, priority.
- The mapping is saved per company with the header list. When the same headers appear again, it's applied automatically.
- The preview shows 20 rows.
- Bad rows are skipped with a reason and can be downloaded as CSV. Reasons:
  - missing ID;
  - missing question;
  - bad date;
  - ID repeated in the file.

**Library drafts**
- Every imported issue with a staff answer creates a draft:
  - `KnowledgeEntry` with `status: "draft"` and `isActive: false`;
  - `projectId` and `sourceTicketId` set;
  - the category is "Imported", created if missing.
- Approving one sets `status: "approved"` and `isActive: true`.
- Per-project use of Library entries by the AI is stage 4.

**AI tidy**
- Only when AI is configured. Titles are 70 characters or fewer, in the issue's language, with a short category.
- It merges an unanswered issue into the next issue from the same sender within 24 hours, only when the AI says they're the same problem.
- Failures are ignored. Issues are sent in batches of 10.

**Background processing**
- Imports run in the worker, 200 issues or rows per run per company. They resume from `progress` after a crash.

**Permission**
- New permission `imports:run` for supervisor, admin and owner.

## File map

| File | Status | Job |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261010000000_imports/migration.sql` | modify / new | `ImportJob`, `ChatSender`, `ImportMapping`, `Ticket.importKey`, `Message.importKey`, `KnowledgeEntry.projectId/status/sourceTicketId` |
| `src/lib/imports/whatsapp/parse.ts` | new | chat text to messages |
| `src/lib/imports/whatsapp/group.ts` | new | messages to issues, import keys |
| `src/lib/imports/whatsapp/zip.ts` | new | safe unzip of the chat text and images |
| `src/lib/imports/csv/parse.ts`, `src/lib/imports/csv/rows.ts` | new | CSV reading, mapping, validation |
| `src/lib/imports/write.ts` | new | create imported tickets, customers and drafts (no emails, no SLA) |
| `src/lib/imports/ai-tidy.ts` | new | optional titles, categories and merges |
| `src/lib/imports/run.ts`, `src/lib/jobs/imports.ts` | new | the import job in the worker |
| `src/app/api/imports/**` | new | upload, preview, confirm, status, bad-rows download |
| `src/app/(dashboard)/imports/**` | new | import screens |
| `src/app/(dashboard)/knowledge/drafts/page.tsx`, `src/app/api/knowledge/drafts/**` | new | Library > Waiting approval |

---

### Task 1: Database

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/tenant/links.ts`, `src/lib/rbac.ts`, `tests/setup.ts`, `tests/unit/rbac.test.ts`
- Create: `prisma/migrations/20261010000000_imports/migration.sql`, `tests/integration/imports-schema.test.ts`

**Interfaces:**
- Produces:
  - `ImportJob { id, companyId, projectId, kind "whatsapp"|"csv", status "uploaded"|"queued"|"running"|"done"|"failed", fileKey?, fileName, options Json, preview Json, progress Json, stats Json, badRows Json, error, createdById?, createdAt, startedAt?, finishedAt? }`
  - `ChatSender { id, companyId, name, isStaff }`, unique on (companyId, name)
  - `ImportMapping { id, companyId, headers String, mapping Json, updatedAt }`, unique on (companyId, headers)
  - `Ticket.importKey String?` with `@@unique([companyId, importKey])`
  - `Message.importKey String?` with `@@unique([companyId, importKey])`
  - `KnowledgeEntry.projectId String?`, `status String @default("approved")`, `sourceTicketId String?`
  - permission `"imports:run"`

- [ ] **Step 1: Schema**

Add `importJobs ImportJob[]`, `chatSenders ChatSender[]` and `importMappings ImportMapping[]` to `model Company`. Add `importJobs ImportJob[]` and `knowledgeEntries KnowledgeEntry[]` to `model Project`.

Add to `model Ticket`: `importKey String?` and `@@unique([companyId, importKey])`. Add to `model Ticket`: `knowledgeDrafts KnowledgeEntry[]`.

Add to `model Message`: `importKey String?` and `@@unique([companyId, importKey])`.

Add to `model KnowledgeEntry`:

```prisma
  projectId      String?
  project        Project? @relation(fields: [projectId], references: [id], onDelete: Cascade)
  status         String   @default("approved") // draft, approved
  sourceTicketId String?
  sourceTicket   Ticket?  @relation(fields: [sourceTicketId], references: [id], onDelete: SetNull)
```

Also add `@@index([projectId, status])` to `KnowledgeEntry`.

New models:

```prisma
model ImportJob {
  id          String    @id @default(uuid())
  companyId   String    @default("")
  company     Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  projectId   String
  project     Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  kind        String // whatsapp, csv
  status      String    @default("uploaded") // uploaded, queued, running, done, failed
  fileKey     String?
  fileName    String    @default("")
  options     Json      @default("{}")
  preview     Json      @default("{}")
  progress    Json      @default("{}")
  stats       Json      @default("{}")
  badRows     Json      @default("[]")
  error       String    @default("")
  createdById String?
  createdAt   DateTime  @default(now())
  startedAt   DateTime?
  finishedAt  DateTime?

  @@index([companyId, status])
}

model ChatSender {
  id        String  @id @default(uuid())
  companyId String  @default("")
  company   Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
  name      String
  isStaff   Boolean @default(false)

  @@unique([companyId, name])
}

model ImportMapping {
  id        String   @id @default(uuid())
  companyId String   @default("")
  company   Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  headers   String
  mapping   Json     @default("{}")
  updatedAt DateTime @updatedAt

  @@unique([companyId, headers])
}
```

`createdById` is kept as a plain string with no relation, so a deleted user doesn't break history. Don't add it to LINKS.

Run: `npx prisma validate`. Expected: valid.

- [ ] **Step 2: Migration**

Create `prisma/migrations/20261010000000_imports/migration.sql`:

```sql
ALTER TABLE "Ticket" ADD COLUMN "importKey" TEXT;
CREATE UNIQUE INDEX "Ticket_companyId_importKey_key" ON "Ticket"("companyId", "importKey");
ALTER TABLE "Message" ADD COLUMN "importKey" TEXT;
CREATE UNIQUE INDEX "Message_companyId_importKey_key" ON "Message"("companyId", "importKey");

ALTER TABLE "KnowledgeEntry"
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN "sourceTicketId" TEXT;
CREATE INDEX "KnowledgeEntry_projectId_status_idx" ON "KnowledgeEntry"("projectId", "status");
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_sourceTicketId_fkey" FOREIGN KEY ("sourceTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "fileKey" TEXT,
    "fileName" TEXT NOT NULL DEFAULT '',
    "options" JSONB NOT NULL DEFAULT '{}',
    "preview" JSONB NOT NULL DEFAULT '{}',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "badRows" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ImportJob_companyId_status_idx" ON "ImportJob"("companyId", "status");
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatSender" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ChatSender_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatSender_companyId_name_key" ON "ChatSender"("companyId", "name");
ALTER TABLE "ChatSender" ADD CONSTRAINT "ChatSender_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ImportMapping" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "headers" TEXT NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImportMapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImportMapping_companyId_headers_key" ON "ImportMapping"("companyId", "headers");
ALTER TABLE "ImportMapping" ADD CONSTRAINT "ImportMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Back up the dev db, then apply the migration to it and to the test db:

```bash
PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/pg_dump.exe -h localhost -U helpplus -d helpplus -Fc -f .superpowers/backup/helpplus-before-3b.dump
PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/psql.exe -h localhost -U helpplus -d helpplus -v ON_ERROR_STOP=1 -f prisma/migrations/20261010000000_imports/migration.sql
npx prisma db push && npx prisma generate
DATABASE_URL="postgresql://helpplus:helpplus_dev_2026@localhost:5432/helpplus_test?schema=public" npx prisma migrate deploy
```

Expected:
- `db push` reports the schema is already in sync. Stop the dev server before `generate`.
- `migrate deploy` applies 1 migration.

- [ ] **Step 3: Links, permission, mocks**

In `src/lib/tenant/links.ts`:
- Add `ImportJob: { projectId: "Project" }`.
- Add `projectId: "Project"` and `sourceTicketId: "Ticket"` to the `KnowledgeEntry` entry.
- Add the matching `RELATIONS`: `ImportJob.project`, `Project.importJobs`, `Project.knowledgeEntries`, `KnowledgeEntry.project`, `KnowledgeEntry.sourceTicket`, `Ticket.knowledgeDrafts`.
- Follow what `tests/unit/tenant-links.test.ts` reports.

In `src/lib/rbac.ts`, add `"imports:run": ["supervisor", "admin", "owner"],`. Add a test: staff can't run imports, supervisors can.

In `tests/setup.ts`, add `"importJob"`, `"chatSender"` and `"importMapping"` to the mocked models.

- [ ] **Step 4: Integration test**

Create `tests/integration/imports-schema.test.ts`. Use the company-setup pattern from earlier integration tests, with company ids prefixed `it-3b-`. Cover:
- **Ticket import keys are unique per company.** The same `importKey` in one company is refused with P2002; in another company it's allowed.
- **Message import keys work the same way.**
- **A KnowledgeEntry draft** created with `status: "draft", isActive: false` is excluded by `findMany({ where: { isActive: true } })`.
- **An ImportJob can't point at another company's project.** It's refused with `CrossCompanyLinkError`.

- [ ] **Step 5: Commit**

Run `npx tsc --noEmit`, `npx vitest run` and `npm run test:integration`.

```bash
git add prisma src/lib/tenant/links.ts src/lib/rbac.ts tests/setup.ts tests/unit/rbac.test.ts tests/integration/imports-schema.test.ts
git commit -m "import jobs, chat senders, column mappings, library drafts"
```

---

### Task 2: WhatsApp chat parser

**Files:**
- Create: `src/lib/imports/whatsapp/parse.ts`, `tests/unit/wa-parse.test.ts`, `tests/fixtures/wa/android-en.txt`, `tests/fixtures/wa/android-24h.txt`, `tests/fixtures/wa/iphone.txt`, `tests/fixtures/wa/us-order.txt`

**Interfaces:**
- Produces:
  - `type DateOrder = "dmy" | "mdy"`
  - `interface ChatMessage { at: Date; sender: string; text: string; attachment: string | null; system: boolean }`
  - `detectDateOrder(text: string): DateOrder`
  - `parseChat(text: string, opts?: { order?: DateOrder; offsetMinutes?: number }): { messages: ChatMessage[]; order: DateOrder; skippedLines: number }`

Notes:
- **Timestamps.** Exports have no timezone. `offsetMinutes` is the company timezone offset; default 480 (UTC+8). Each local time becomes a UTC `Date` by subtracting it.
- **Real samples.** The exact export formats vary by phone, OS version and language. The fixtures below cover the common English formats. Before this stage is merged, ask the user for one real Android export and one real iPhone export (with names redacted), and add a test for each (see "Done when").

- [ ] **Step 1: Fixtures**

Create `tests/fixtures/wa/android-en.txt` (Android, 12-hour, day/month):

```
12/10/2026, 9:05 am - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.
12/10/2026, 9:06 am - Aminah: Salam, report bulanan kosong
12/10/2026, 9:06 am - Aminah: IC saya 900101-14-5678
dah cuba refresh
12/10/2026, 9:30 am - Support Ali: Cuba clear cache dan login semula
12/10/2026, 9:41 am - Aminah: Ok dah boleh, terima kasih
13/10/2026, 2:15 pm - +60 12-345 6789: IMG-20261013-WA0001.jpg (file attached)
Screen ni keluar error
13/10/2026, 2:16 pm - Support Ali added +60 13-111 2222
```

Create `tests/fixtures/wa/android-24h.txt`:

```
13/10/2026, 21:05 - Ben: Can't upload files
13/10/2026, 21:40 - Helpdesk: Fixed now, please try again
```

Create `tests/fixtures/wa/iphone.txt`. Lines start with U+200E on some phones; include it on the attachment line.

```
[12/10/2026, 09:06:12] Aminah: Salam, report bulanan kosong
[12/10/2026, 09:30:01] Support Ali: Cuba clear cache
‎[12/10/2026, 09:31:44] Aminah: ‎<attached: 00000012-PHOTO-2026-10-12-09-31-44.jpg>
[12/10/2026, 9:45:00 PM] Aminah: Ok terima kasih
```

Create `tests/fixtures/wa/us-order.txt`:

```
10/13/26, 9:05 PM - Ben: Hello
10/13/26, 9:06 PM - Kim: Hi Ben
```

- [ ] **Step 2: Tests first**

Create `tests/unit/wa-parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parseChat, detectDateOrder } from "@/lib/imports/whatsapp/parse";

const fixture = (name: string) => readFileSync(path.join(__dirname, "../fixtures/wa", name), "utf8");
const utc = (s: string) => new Date(s);

describe("detectDateOrder", () => {
  it("reads day first when a first number is over 12", () => {
    expect(detectDateOrder(fixture("android-en.txt"))).toBe("dmy");
  });
  it("reads month first when a second number is over 12", () => {
    expect(detectDateOrder(fixture("us-order.txt"))).toBe("mdy");
  });
  it("defaults to day first", () => {
    expect(detectDateOrder("01/02/2026, 10:00 - A: hi")).toBe("dmy");
  });
});

describe("parseChat android", () => {
  const { messages } = parseChat(fixture("android-en.txt"));

  it("marks the encryption notice and added lines as system", () => {
    expect(messages[0].system).toBe(true);
    expect(messages.at(-1)?.system).toBe(true);
  });

  it("reads sender, text and time in utc+8", () => {
    const m = messages[1];
    expect(m.sender).toBe("Aminah");
    expect(m.text).toBe("Salam, report bulanan kosong");
    expect(m.at).toEqual(utc("2026-10-12T01:06:00Z"));
  });

  it("joins continuation lines to the message above", () => {
    expect(messages[2].text).toBe("IC saya 900101-14-5678\ndah cuba refresh");
  });

  it("handles pm", () => {
    expect(messages.find((m) => m.sender === "+60 12-345 6789")?.at).toEqual(utc("2026-10-13T06:15:00Z"));
  });

  it("picks up attachments", () => {
    const m = messages.find((x) => x.attachment);
    expect(m?.attachment).toBe("IMG-20261013-WA0001.jpg");
    expect(m?.text).toBe("Screen ni keluar error");
  });
});

describe("parseChat other formats", () => {
  it("reads 24 hour android", () => {
    const { messages } = parseChat(fixture("android-24h.txt"));
    expect(messages).toHaveLength(2);
    expect(messages[0].at).toEqual(utc("2026-10-13T13:05:00Z"));
  });

  it("reads iphone with seconds, brackets and the invisible mark", () => {
    const { messages } = parseChat(fixture("iphone.txt"));
    expect(messages).toHaveLength(4);
    expect(messages[0].at).toEqual(utc("2026-10-12T01:06:12Z"));
    expect(messages[2].attachment).toBe("00000012-PHOTO-2026-10-12-09-31-44.jpg");
    expect(messages[2].text).toBe("");
    expect(messages[3].at).toEqual(utc("2026-10-12T13:45:00Z"));
  });

  it("reads month first with two digit years", () => {
    const { messages, order } = parseChat(fixture("us-order.txt"));
    expect(order).toBe("mdy");
    expect(messages[0].at).toEqual(utc("2026-10-13T13:05:00Z"));
  });

  it("can be told the order", () => {
    const { messages } = parseChat("01/02/2026, 10:00 - A: hi", { order: "mdy" });
    expect(messages[0].at).toEqual(utc("2026-01-02T02:00:00Z"));
  });

  it("counts lines it can't place", () => {
    expect(parseChat("random first line\n12/10/2026, 10:00 - A: hi").skippedLines).toBe(1);
  });
});
```

Run it. Expected: FAIL, module not found.

- [ ] **Step 3: Implementation**

Create `src/lib/imports/whatsapp/parse.ts`:

```ts
export type DateOrder = "dmy" | "mdy";

export interface ChatMessage {
  at: Date;
  sender: string;
  text: string;
  attachment: string | null;
  system: boolean;
}

// android: "12/10/2026, 9:05 am - Name: text"   iphone: "[12/10/2026, 09:06:12] Name: text"
const LINE =
  /^‎?\[?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\]?\s*(?:-\s)?(.*)$/i;
const ATTACHED = [/^‎?<attached:\s*(.+?)>\s*/i, /^(\S+\.\w{2,5}) \(file attached\)\s*/i];
const SYSTEM = [
  /end-to-end encrypted/i,
  /^.+ (added|removed|left|joined|changed (the )?(subject|group|this group)|created group)/i,
  /security code (with|changed)/i,
  /^.+ joined using this group's invite link/i,
];

export function detectDateOrder(text: string): DateOrder {
  let firstOver = false;
  let secondOver = false;
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    if (Number(m[1]) > 12) firstOver = true;
    if (Number(m[2]) > 12) secondOver = true;
  }
  if (secondOver && !firstOver) return "mdy";
  return "dmy";
}

function toDate(m: RegExpExecArray, order: DateOrder, offsetMinutes: number): Date | null {
  const a = Number(m[1]);
  const b = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  const [day, month] = order === "dmy" ? [a, b] : [b, a];
  let hour = Number(m[4]);
  const ampm = m[7]?.toLowerCase().replace(/[.\s]/g, "");
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23) return null;
  const local = Date.UTC(year, month - 1, day, hour, Number(m[5]), Number(m[6] ?? 0));
  return new Date(local - offsetMinutes * 60_000);
}

function splitBody(body: string): { sender: string; text: string; system: boolean } {
  const colon = body.indexOf(": ");
  if (colon > 0 && colon < 60) {
    return { sender: body.slice(0, colon).replace(/‎/g, "").trim(), text: body.slice(colon + 2), system: false };
  }
  return { sender: "", text: body, system: true };
}

function takeAttachment(text: string): { text: string; attachment: string | null } {
  const clean = text.replace(/^‎/, "");
  for (const re of ATTACHED) {
    const m = re.exec(clean);
    if (m) return { attachment: m[1].trim(), text: clean.slice(m[0].length).trim() };
  }
  return { attachment: null, text };
}

export function parseChat(
  text: string,
  opts: { order?: DateOrder; offsetMinutes?: number } = {}
): { messages: ChatMessage[]; order: DateOrder; skippedLines: number } {
  const order = opts.order ?? detectDateOrder(text);
  const offset = opts.offsetMinutes ?? 480;
  const messages: ChatMessage[] = [];
  let skippedLines = 0;

  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = LINE.exec(raw);
    const at = m ? toDate(m, order, offset) : null;
    if (!m || !at) {
      const last = messages.at(-1);
      if (last) {
        const extra = takeAttachment(raw);
        if (extra.attachment && !last.attachment) last.attachment = extra.attachment;
        if (extra.text) last.text = last.text ? `${last.text}\n${extra.text}` : extra.text;
      } else if (raw.trim()) skippedLines++;
      continue;
    }
    const body = splitBody(m[8]);
    const { text: msgText, attachment } = takeAttachment(body.text);
    const system = body.system || SYSTEM.some((re) => re.test(m[8]));
    messages.push({ at, sender: body.sender, text: msgText.trim(), attachment, system });
  }
  return { messages, order, skippedLines };
}
```

How continuation lines work: a line that has no timestamp but follows a message is appended to that message. If it holds an attachment marker, the marker becomes the message's attachment. This covers the Android format, where the "(file attached)" line comes before the caption.

Android example: `13/10/2026, 2:15 pm - +60 12-345 6789: IMG-...jpg (file attached)` is followed by a caption line. In this case the attachment marker is on the timestamp line and the caption follows. `takeAttachment` on the body finds the file, the following line is appended as text, and the expected text is "Screen ni keluar error".

Run the test. Expected: PASS. If a fixture expectation fails, check the regex against that exact line before changing anything, and report the cause.

- [ ] **Step 4: Commit**

```bash
git add src/lib/imports/whatsapp/parse.ts tests/unit/wa-parse.test.ts tests/fixtures/wa
git commit -m "read whatsapp chat exports"
```

---

### Task 3: Split chats into issues

**Files:**
- Create: `src/lib/imports/whatsapp/group.ts`, `tests/unit/wa-group.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` (Task 2).
- Produces:
  - `interface Issue { messages: ChatMessage[]; client: string; answered: boolean; firstAt: Date; lastAt: Date; firstReplyAt: Date | null }`
  - `groupIssues(messages: ChatMessage[], isStaff: (sender: string) => boolean): { issues: Issue[]; announcements: number }`
  - `messageKey(projectId: string, m: ChatMessage): string`, which returns `wa:` plus a hex sha256
  - `issueKey(projectId: string, issue: Issue): string`
  - `QUIET_GAP_MS = 4 * 3600_000` and `AFTER_ANSWER_GAP_MS = 30 * 60_000`

- [ ] **Step 1: Tests first**

Create `tests/unit/wa-group.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { groupIssues, messageKey, issueKey } from "@/lib/imports/whatsapp/group";
import type { ChatMessage } from "@/lib/imports/whatsapp/parse";

const t0 = Date.UTC(2026, 9, 12, 1, 0);
const msg = (min: number, sender: string, text = "x", system = false): ChatMessage => ({
  at: new Date(t0 + min * 60_000),
  sender,
  text,
  attachment: null,
  system,
});
const staff = (s: string) => s.startsWith("Support");

describe("groupIssues", () => {
  it("keeps a question and its replies together", () => {
    const { issues } = groupIssues([msg(0, "Aminah"), msg(1, "Aminah"), msg(20, "Support Ali"), msg(25, "Aminah", "thanks")], staff);
    expect(issues).toHaveLength(1);
    expect(issues[0].answered).toBe(true);
    expect(issues[0].firstReplyAt).toEqual(new Date(t0 + 20 * 60_000));
  });

  it("starts a new issue after an answer and a 30 minute gap", () => {
    const { issues } = groupIssues([msg(0, "Aminah"), msg(10, "Support Ali"), msg(50, "Aminah", "another thing")], staff);
    expect(issues).toHaveLength(2);
  });

  it("starts a new issue after 4 quiet hours even without an answer", () => {
    const { issues } = groupIssues([msg(0, "Ben"), msg(5 * 60, "Ben")], staff);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => !i.answered)).toBe(true);
  });

  it("lets different clients ask inside the same open issue window", () => {
    const { issues } = groupIssues([msg(0, "Aminah"), msg(3, "Ben"), msg(10, "Support Ali")], staff);
    expect(issues).toHaveLength(1);
    expect(issues[0].client).toBe("Aminah");
  });

  it("skips system lines and counts staff announcements", () => {
    const { issues, announcements } = groupIssues([msg(0, "", "added", true), msg(1, "Support Ali", "Server down tonight")], staff);
    expect(issues).toHaveLength(0);
    expect(announcements).toBe(1);
  });
});

describe("keys", () => {
  it("are stable and change with the content", () => {
    const a = msg(0, "Aminah", "hello");
    expect(messageKey("p1", a)).toBe(messageKey("p1", { ...a }));
    expect(messageKey("p1", a)).not.toBe(messageKey("p1", { ...a, text: "hello!" }));
    expect(messageKey("p1", a)).not.toBe(messageKey("p2", a));
    expect(messageKey("p1", a)).toMatch(/^wa:[0-9a-f]{64}$/);
  });

  it("ignore seconds so iphone and android exports of the same chat match", () => {
    const a = msg(0, "Aminah", "hello");
    const b = { ...a, at: new Date(a.at.getTime() + 37_000) };
    expect(messageKey("p1", a)).toBe(messageKey("p1", b));
  });

  it("issue key is the first message key", () => {
    const { issues } = groupIssues([msg(0, "Aminah", "q")], staff);
    expect(issueKey("p1", issues[0])).toBe(messageKey("p1", issues[0].messages[0]).replace(/^wa:/, "wa-issue:"));
  });
});
```

Run it. Expected: FAIL, module not found.

- [ ] **Step 2: Implementation**

Create `src/lib/imports/whatsapp/group.ts`:

```ts
import { createHash } from "crypto";
import type { ChatMessage } from "./parse";

export const QUIET_GAP_MS = 4 * 3600_000;
export const AFTER_ANSWER_GAP_MS = 30 * 60_000;

export interface Issue {
  messages: ChatMessage[];
  client: string;
  answered: boolean;
  firstAt: Date;
  lastAt: Date;
  firstReplyAt: Date | null;
}

export function groupIssues(messages: ChatMessage[], isStaff: (sender: string) => boolean) {
  const issues: Issue[] = [];
  let announcements = 0;
  let current: Issue | null = null;

  for (const m of [...messages].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (m.system || !m.sender) continue;
    const gap = current ? m.at.getTime() - current.lastAt.getTime() : Infinity;
    if (isStaff(m.sender)) {
      if (!current || gap >= QUIET_GAP_MS) {
        announcements++;
        current = null;
        continue;
      }
      current.messages.push(m);
      current.lastAt = m.at;
      if (!current.answered) {
        current.answered = true;
        current.firstReplyAt = m.at;
      }
      continue;
    }
    const startNew = !current || gap >= QUIET_GAP_MS || (current.answered && gap >= AFTER_ANSWER_GAP_MS);
    if (startNew) {
      current = { messages: [m], client: m.sender, answered: false, firstAt: m.at, lastAt: m.at, firstReplyAt: null };
      issues.push(current);
    } else {
      current!.messages.push(m);
      current!.lastAt = m.at;
    }
  }
  return { issues, announcements };
}

// minute precision so the same chat exported from different phones lines up
function minuteIso(d: Date): string {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000).toISOString();
}

export function messageKey(projectId: string, m: ChatMessage): string {
  const raw = [projectId, minuteIso(m.at), m.sender, m.text, m.attachment ?? ""].join("\u0001");
  return `wa:${createHash("sha256").update(raw).digest("hex")}`;
}

export function issueKey(projectId: string, issue: Issue): string {
  return messageKey(projectId, issue.messages[0]).replace(/^wa:/, "wa-issue:");
}
```

Run the test. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/imports/whatsapp/group.ts tests/unit/wa-group.test.ts
git commit -m "split imported chats into issues"
```

---

### Task 4: Writing imported tickets and Library drafts

**Files:**
- Create: `src/lib/imports/write.ts`, `tests/integration/imports-write.test.ts`

**Interfaces:**
- Consumes:
  - `maskIC`
  - `nextTicketNumber`
  - `titleFrom`
  - `addAttachment(input, { process: false })` from 3A
  - `Issue`, `messageKey` and `issueKey` from Task 3
- Produces:
  - `interface ImportedQa { importKey: string; projectId: string; source: "whatsapp_export" | "old_system"; title?: string; category?: string; priority?: string; client: { name: string; contact?: string }; messages: { role: "customer" | "agent"; text: string; at: Date; importKey?: string; author?: string }[]; status: "closed" | "new"; closeNote?: string; closedAt?: Date | null; images?: { fileName: string; data: Buffer; messageIndex: number }[] }`
  - `writeImportedTicket(qa: ImportedQa): Promise<{ created: boolean; ticketId?: string; draftId?: string; images: number; skippedImages: number }>`
  - `importedCategoryId(): Promise<string>`

- [ ] **Step 1: Integration test first**

Create `tests/integration/imports-write.test.ts`. Use the `it-3b-write` company, the 3A temp storage dir pattern, and `closeOcr` in afterAll. Cover these cases:
- **IC masking and dates.** A Q&A with an IC in the question and a staff answer creates exactly one closed ticket with:
  - `source: "whatsapp_export"`;
  - `importKey` set;
  - the first message's time as `createdAt`;
  - `answeredAt` and `firstReplyAt` set to the agent message time;
  - `closedAt` set to the last message;
  - no SLA times (`resolveDueAt` null);
  - all message text with `[IC HIDDEN]` and no digits of the IC;
  - each message's `importKey` set.
- **No emails.** Nothing is queued in `EmailOutbox`, even when a user has `notifyNew: true`.
- **Library draft.** A draft `KnowledgeEntry` is created with:
  - `status: "draft"` and `isActive: false`;
  - the right `projectId` and `sourceTicketId`;
  - the "Imported" category;
  - content `"Q: …\n\nA: …"`, IC-masked.
- **Re-import.** Writing the same `importKey` again returns `created: false` and creates nothing.
- **Unanswered and new.** An unanswered `status: "new"` Q&A creates an open ticket with no draft.
- **Unanswered and closed.** An unanswered `status: "closed"` Q&A with `closeNote` creates a closed ticket with an internal note.
- **Customers.**
  - A client with a phone-like name (`"+60 12-345 6789"`) is found or created as one customer with `phone` normalised to digits.
  - The same name later reuses the same customer.
  - The customer's `projectId` is set.
- **Images.**
  - An image becomes an attachment with status `pending`, linked to the right message.
  - A non-image counts as `skippedImages`.

Run: `npm run test:integration`. Expected: FAIL.

- [ ] **Step 2: Implementation**

Create `src/lib/imports/write.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { maskIC } from "@/lib/privacy/ic-mask";
import { nextTicketNumber } from "@/lib/tickets/number";
import { titleFrom } from "@/lib/tickets/service";
import { addAttachment } from "@/lib/attachments/service";
import { isAllowedImage } from "@/lib/privacy/ic-image";

export interface ImportedQa {
  importKey: string;
  projectId: string;
  source: "whatsapp_export" | "old_system";
  title?: string;
  category?: string;
  priority?: string;
  client: { name: string; contact?: string };
  messages: { role: "customer" | "agent"; text: string; at: Date; importKey?: string; author?: string }[];
  status: "closed" | "new";
  closeNote?: string;
  closedAt?: Date | null;
  images?: { fileName: string; data: Buffer; messageIndex: number }[];
}

const mask = (s: string) => maskIC(s).text;
const IMPORTED = "Imported";

export async function importedCategoryId(): Promise<string> {
  const found = await prisma.category.findFirst({ where: { name: IMPORTED }, select: { id: true } });
  if (found) return found.id;
  const created = await prisma.category.create({ data: { name: IMPORTED, description: "Answers brought in from imports" } });
  return created.id;
}

// a sender that looks like a number is matched by phone, anyone else by name
async function customerFor(projectId: string, client: { name: string; contact?: string }) {
  const digits = (client.contact || client.name).replace(/\D/g, "");
  const isPhone = digits.length >= 8 && /^[+\d\s()-]+$/.test(client.contact || client.name);
  const name = mask(client.name).slice(0, 200) || "Unknown";
  const existing = await prisma.customer.findFirst({
    where: isPhone ? { phone: digits } : { name },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.customer.create({
    data: { name, phone: isPhone ? digits : "", projectId },
  });
  return created.id;
}

export async function writeImportedTicket(qa: ImportedQa) {
  if (await prisma.ticket.findFirst({ where: { importKey: qa.importKey }, select: { id: true } })) {
    return { created: false, images: 0, skippedImages: 0 };
  }
  const msgs = [...qa.messages].sort((a, b) => a.at.getTime() - b.at.getTime());
  const question = msgs.filter((m) => m.role === "customer").map((m) => mask(m.text)).join("\n").trim();
  const answers = msgs.filter((m) => m.role === "agent").map((m) => mask(m.text)).join("\n").trim();
  const firstReply = msgs.find((m) => m.role === "agent")?.at ?? null;
  const first = msgs[0]?.at ?? new Date();
  const last = msgs.at(-1)?.at ?? first;

  const customerId = await customerFor(qa.projectId, qa.client);
  const conversation = await prisma.conversation.create({
    data: {
      channel: "whatsapp",
      customerName: mask(qa.client.name).slice(0, 200) || "Unknown",
      customerContact: mask(qa.client.contact ?? "").slice(0, 200),
      customerId,
      status: qa.status === "closed" ? "closed" : "active",
      createdAt: first,
    },
  });

  const saved: { id: string }[] = [];
  for (const m of msgs) {
    const row = await prisma.message.create({
      data: { conversationId: conversation.id, role: m.role, content: mask(m.text), createdAt: m.at, importKey: m.importKey ?? null },
    });
    saved.push(row);
  }

  const closed = qa.status === "closed";
  const ticket = await prisma.ticket.create({
    data: {
      number: await nextTicketNumber(),
      title: mask(qa.title?.trim() || titleFrom(question || answers)).slice(0, 200),
      description: question || answers,
      source: qa.source,
      projectId: qa.projectId,
      priority: qa.priority ?? "medium",
      category: qa.category ?? "",
      status: closed ? "closed" : "new",
      conversationId: conversation.id,
      importKey: qa.importKey,
      createdAt: first,
      firstReplyAt: firstReply,
      answeredAt: firstReply,
      closedAt: closed ? (qa.closedAt ?? last) : null,
    },
  });

  if (qa.closeNote) {
    await prisma.internalNote.create({ data: { conversationId: conversation.id, content: qa.closeNote, authorName: "Help+" } });
  }

  let draftId: string | undefined;
  if (question && answers) {
    const draft = await prisma.knowledgeEntry.create({
      data: {
        categoryId: await importedCategoryId(),
        title: ticket.title,
        content: `Q: ${question}\n\nA: ${answers}`,
        isActive: false,
        status: "draft",
        projectId: qa.projectId,
        sourceTicketId: ticket.id,
      },
    });
    draftId = draft.id;
  }

  let images = 0;
  let skippedImages = 0;
  for (const img of qa.images ?? []) {
    if (!(await isAllowedImage(img.data))) {
      skippedImages++;
      continue;
    }
    await addAttachment(
      { ticketId: ticket.id, messageId: saved[img.messageIndex]?.id ?? null, fileName: img.fileName, data: img.data },
      { process: false }
    );
    images++;
  }
  return { created: true, ticketId: ticket.id, draftId, images, skippedImages };
}
```

Then check these against the code; they may need small adjustments:
- `addAttachment`'s second argument `{ process: false }` exists after 3A. Check its exact name in `src/lib/attachments/service.ts`.
- `addAttachment` already IC-masks the file name.
- A `Message` with a duplicate `importKey` throws P2002. That only happens if two concurrent imports overlap. Catch it per message, skip the message, and keep going.
- The `Customer` model's phone field is `phone`; check the exact field.

Run: `npm run test:integration`. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/imports/write.ts tests/integration/imports-write.test.ts
git commit -m "write imported tickets, customers and library drafts"
```

---

### Task 5: CSV reading and row checks

**Files:**
- Create: `src/lib/imports/csv/parse.ts`, `src/lib/imports/csv/rows.ts`, `tests/unit/csv-import.test.ts`
- Modify: `package.json` (add `papaparse` and `@types/papaparse`)

**Interfaces:**
- Produces:
  - `readCsv(text: string): { headers: string[]; rows: Record<string, string>[] }`
  - `headersSignature(headers: string[]): string`, which returns the lower-cased trimmed headers joined with "|"
  - `type CsvField = "oldId" | "question" | "answer" | "title" | "clientName" | "clientContact" | "createdAt" | "closedAt" | "category" | "priority"`
  - `type CsvMapping = Partial<Record<CsvField, string>>`, mapping each field to a header
  - `guessMapping(headers: string[]): CsvMapping`
  - `checkRows(rows: Record<string, string>[], mapping: CsvMapping, order: "dmy" | "mdy"): { good: GoodRow[]; bad: { line: number; reason: string; raw: Record<string, string> }[] }`
  - `GoodRow = { line: number; oldId: string; question: string; answer: string; title: string; clientName: string; clientContact: string; createdAt: Date | null; closedAt: Date | null; category: string; priority: string }`
  - `badRowsCsv(bad): string`
  - `parseLooseDate(s: string, order: "dmy" | "mdy", offsetMinutes?: number): Date | null`

- [ ] **Step 1: Install and test first**

```bash
npm install papaparse@^5.7 && npm install -D @types/papaparse
```

Create `tests/unit/csv-import.test.ts`. Cover these cases:
- **`readCsv`**
  - Reads quoted fields with commas and newlines.
  - Ignores a BOM.
  - Trims header names.
  - Skips fully empty lines.
- **`guessMapping`** maps these headers:

  | Header | Field |
  |---|---|
  | `ID` / `Ticket ID` / `No` | `oldId` |
  | `Question` / `Issue` / `Description` / `Masalah` | `question` |
  | `Answer` / `Reply` / `Solution` / `Jawapan` | `answer` |
  | `Client` / `Customer` / `Name` | `clientName` |
  | `Phone` / `Email` / `Contact` | `clientContact` |
  | `Created` / `Date` / `Tarikh` | `createdAt` |
  | `Closed` / `Resolved` | `closedAt` |
  | `Category` | `category` |
  | `Priority` | `priority` |

  Matching is case-insensitive and also accepts "contains" matches.
- **`checkRows`**
  - Flags a missing ID: "Missing ID".
  - Flags a missing question: "Missing question".
  - Flags an ID repeated within the file: "ID repeated in the file". The first one stays good.
  - Flags an unreadable date in a mapped date column: "Can't read date: <value>".
  - Returns good rows with trimmed values. Line numbers count the header as line 1.
- **`parseLooseDate`** reads:
  - `2026-10-12`
  - `2026-10-12 14:30`
  - `12/10/2026`
  - `12/10/2026 2:30 PM`
  - `10/12/2026` with `mdy`

  It returns null for `yesterday`. Times are taken in UTC+8 by default, the same offset as the chat parser.
- **`badRowsCsv`** produces a CSV with a `reason` column first, followed by the original columns, quoted correctly.

Run it. Expected: FAIL.

- [ ] **Step 2: Implementation**

Create `src/lib/imports/csv/parse.ts` with `readCsv` and `headersSignature`. Use Papa with `{ header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() }` and strip a leading `﻿` from the text first.

Create `src/lib/imports/csv/rows.ts` with `guessMapping`, `parseLooseDate`, `checkRows` and `badRowsCsv`, as specified above. `badRowsCsv` writes with `Papa.unparse`.

Keep both files plain and readable. Add one short comment only where a rule isn't obvious, for example the default day/month order.

Run the test. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/lib/imports/csv tests/unit/csv-import.test.ts
git commit -m "read csv exports and check each row"
```

---

### Task 6: Import jobs, upload, preview and the worker

**Files:**
- Create:
  - `src/lib/imports/whatsapp/zip.ts`
  - `src/lib/imports/ai-tidy.ts`
  - `src/lib/imports/run.ts`
  - `src/lib/jobs/imports.ts`
  - `src/app/api/imports/route.ts`
  - `src/app/api/imports/[id]/route.ts`
  - `src/app/api/imports/[id]/start/route.ts`
  - `src/app/api/imports/[id]/bad-rows/route.ts`
  - `tests/unit/wa-zip.test.ts`
  - `tests/api/imports.test.ts`
  - `tests/integration/imports-run.test.ts`
- Modify: `src/lib/jobs/run.ts` (add the job), `package.json` (`fflate`)

**Interfaces:**
- Consumes: Tasks 2-5, `encryptBuffer`/`decryptBuffer`, `fileStore`, `chatConfig`/`isConfigured`/`chatCompletion`, `getSettings`.
- Produces (HTTP):
  - `POST /api/imports` (multipart: `file`, `projectId`, `kind` = `whatsapp` or `csv`) → 201 `{ id, kind, preview }`
    - For WhatsApp, `preview` is `{ order, senders: { name, count, isStaff }[], messages, issues, answered, attachments, sample: { client, firstLine, answered }[] }`.
    - For CSV, `preview` is `{ headers, mapping, rows: first 20 mapped, good, bad }`.
  - `GET /api/imports` → list of jobs (newest first, 20) with status and stats
  - `GET /api/imports/:id` → the job (no file contents)
  - `POST /api/imports/:id/start` with `{ order?, staff?: string[], mapping? }` → queues the job
  - `GET /api/imports/:id/bad-rows` → `text/csv` download
- Produces (code):
  - `readExport(data: Buffer, fileName: string): { chat: string; files: Map<string, Buffer>; skippedFiles: number }`
  - `runImportBatch(jobId: string, now: Date): Promise<"running" | "done" | "failed">`
  - `runImports(now: Date)`

All routes use `withAuth("imports:run")`.

- [ ] **Step 1: Safe unzip, test first**

```bash
npm install fflate@^0.8
```

Create `src/lib/imports/whatsapp/zip.ts`:
- A plain `.txt` returns its UTF-8 text with no files.
- A `.zip` uses fflate's `unzipSync` with a `filter` callback that refuses entries once any limit would be passed:
  - more than 5000 entries;
  - more than 500 MB declared uncompressed in total;
  - an image over 10 MB.
- Only these entries are kept:
  - the first `*.txt` whose name contains "chat";
  - image files by extension (jpg, jpeg, png, webp).
- Everything else counts as `skippedFiles`.
- Files are keyed by base name only.
- If the archive is corrupt or has no chat text, throw "This isn't a WhatsApp export".

`tests/unit/wa-zip.test.ts` builds zips in memory with fflate's `zipSync`. Cover:
- a `.txt` upload;
- a zip with the chat plus 2 images plus 1 `.opus` (2 files, 1 skipped);
- a zip with no chat text (throws);
- a zip whose declared total is too big (throws "too large");
- a nested path `media/IMG-1.jpg` keyed as `IMG-1.jpg`.

- [ ] **Step 2: AI tidy**

Create `src/lib/imports/ai-tidy.ts` with `tidyIssues(issues: { key: string; text: string }[]): Promise<Map<string, { title: string; category: string }>>`.
- When AI isn't configured, return an empty map.
- Otherwise send batches of 10, each as one prompt asking for JSON `[{ key, title, category }]`. Titles are 70 characters or fewer, in the same language; categories are one or two words.
- Text is IC-masked before it's sent; `chatCompletion` already masks, but do it here too.
- Any error returns what has been gathered so far.

Also add `sameProblem(a: string, b: string): Promise<boolean>`. It returns false when AI isn't configured or on any error.

Add a unit test with a mocked `chatCompletion`, covering:
- the batching;
- skipping bad JSON;
- the not-configured case.

- [ ] **Step 3: The import run**

Create `src/lib/imports/run.ts` with `runImportBatch(jobId, now)`:

1. **Load the job** and decrypt its file from `fileKey`. Status `queued` becomes `running`, with `startedAt` set.
2. **WhatsApp:**
   1. `readExport`, then `parseChat` with `options.order`.
   2. `groupIssues`. `isStaff` is true for senders in `options.staff`.
   3. Compute the `newestAt` of all messages. Unanswered issues with `lastAt` older than `newestAt` minus 14 days are closed with `closeNote` "No reply in the imported chat". Answered issues are always closed.
   4. Merge pass, only when AI is configured: an unanswered issue followed by the next issue from the same client within 24h is merged when `sameProblem` says so.
   5. Get titles and categories from `tidyIssues`.
   6. From `progress.next`, an issue index, write up to 200 issues with `writeImportedTicket`:
      - `importKey`: `issueKey`
      - message keys: `messageKey`
      - customer messages: role `customer`; staff messages: role `agent`
      - attachments: looked up in `files` by message `attachment` name; images only, with a missing file counted.
   7. Save `progress.next` and the running stats: `created`, `skipped` (already imported), `images`, `skippedImages`, `skippedFiles`, `announcements`, `missingMedia`.
3. **CSV:**
   1. `readCsv`, then `checkRows` with `options.mapping` and `options.order`. Store `badRows` the first time.
   2. From `progress.next`, write up to 200 good rows as Q&A:
      - `importKey`: `csv:` plus the old ID
      - question: role `customer`, at `createdAt` (or now)
      - answer: role `agent`, at `closedAt` (or `createdAt`)
      - status: `closed`
      - `closedAt`: the row's closed date, or the created date
   3. Also save the mapping to `ImportMapping` (upsert by headers signature) on the first batch.
4. **When everything is written:**
   - status becomes `done` and `finishedAt` is set;
   - remove the stored file (`fileStore().remove(fileKey)`) and set `fileKey` to null;
   - stats are final.
5. **On any thrown error:** status becomes `failed`, `error` gets the message (500 characters at most), and the file is kept for a retry.

Create `src/lib/jobs/imports.ts` with `runImports(now)`: one `queued` or `running` job per company per run, oldest first. Add it to `JOBS` in `src/lib/jobs/run.ts`.

`tests/integration/imports-run.test.ts` covers:
- **A WhatsApp `.txt` import** of the android fixture:
  - creates 2 tickets (Aminah's answered issue, and the image sender's unanswered one);
  - creates 1 draft;
  - the job ends `done` with the file removed.
- **Running the same file again** in a new job creates 0 tickets and counts everything as skipped.
- **A CSV with 3 good rows and 2 bad** creates 3 closed tickets and stores 2 bad rows with reasons. A second import of the same CSV creates 0.
- **Batching:** a job over 200 issues finishes over several `runImportBatch` calls. Build the chat text in the test.

- [ ] **Step 4: API**

`POST /api/imports`:
1. Content-Length is required and must be 50 MB or less; otherwise return 411 or 413, the same as the 3A upload.
2. Read the form. The project must be visible to the user (`allowedProjectIds`) and not archived.
3. Build the preview:
   - **WhatsApp:**
     - `readExport` then `parseChat`.
     - List the senders with message counts.
     - Pre-tick `isStaff` from `ChatSender` rows, `TeamMember` names and phones (digits compared), and `Admin.name`.
     - Group the issues once with that guess.
     - The sample shows the first 5 issues, with `firstLine` IC-masked and cut to 80 characters.
   - **CSV:**
     - `readCsv`.
     - The mapping is the saved `ImportMapping` for the headers signature, or `guessMapping`.
     - `checkRows` for the counts.
     - The preview rows are the first 20 good rows, mapped and IC-masked.
4. Store the uploaded bytes encrypted under the key `c/<co>/imports/<jobId>.bin`. Use `fileStore`; adding an `importKeyFor` helper to `src/lib/storage/index.ts` is fine.
5. Create the job with status `uploaded`, the options, the preview and `createdById`.

Errors:
- A file that isn't a WhatsApp export or a CSV returns 400 with a plain message.
- A preview over 5000 issues or 20000 rows returns 413: "Split this file into smaller parts".

`POST /api/imports/:id/start`:
- Only from `uploaded`.
- Saves `staff` to `ChatSender`: upsert each sender in the preview with `isStaff` set to whether it's in the list.
- Merges `order`, `staff` and `mapping` into `options`.
- For CSV, the mapping must include `oldId` and `question`; otherwise 400.
- Sets status `queued`.

`GET /api/imports/:id/bad-rows` returns `badRowsCsv(job.badRows)` with `content-type: text/csv` and `content-disposition: attachment; filename="bad-rows.csv"`.

`tests/api/imports.test.ts` covers, with mocks:
- the `requireAuth` permission is `imports:run`;
- the 411 and 413 size checks;
- a project the user can't see returns 403;
- a CSV preview returns 20 rows at most;
- start returns 409 when the job isn't `uploaded`;
- start for CSV without `oldId` returns 400;
- bad-rows has the right headers.

- [ ] **Step 5: Commit**

Run `npx tsc --noEmit`, `npx vitest run`, `npm run test:integration` and `npm run worker -- --once`; the worker must exit 0.

```bash
git add package.json package-lock.json src/lib/imports src/lib/jobs src/lib/storage/index.ts src/app/api/imports tests
git commit -m "import jobs with preview, worker batches and bad row download"
```

---

### Task 7: Import screens

**Files:**
- Create: `src/app/(dashboard)/imports/page.tsx`, `src/app/(dashboard)/imports/[id]/page.tsx`
- Modify: `src/components/layout/nav-items.ts` and its test, `scripts/smoke-pages.mjs`, `src/app/api/company/route.ts` and `src/lib/hooks/use-company.ts` (add `canImport`), the company test

**Interfaces:**
- Consumes: the Task 6 HTTP API.

- [ ] **Step 1: Company flag**

`GET /api/company` adds `canImport: hasPermission(auth.role, "imports:run")`. `useCompany` adds `canImport: boolean`, with `false` as the fallback. Add a test.

- [ ] **Step 2: Screens**

**`/imports` (Header "Imports", description "Bring in old WhatsApp chats and support history"):**
- Two cards side by side, stacked on phones:
  - "WhatsApp chat": accepts `.txt,.zip`, with the note "Export the chat from WhatsApp (with or without media). Up to 50 MB. Bigger chats: export without media or in parts."
  - "Old system (CSV)": accepts `.csv`, with the note "Save the export as CSV first. Up to 50 MB."
- Each card has a project select (active projects from `/api/projects`, with the default project first), a file input and an "Upload" button.
- Show the upload error inline, and disable the button while uploading.
- When it succeeds, go to `/imports/<id>`.
- Below the cards, a list of recent imports: file name, kind, project, a status dot (done green, failed red, running/queued indigo, uploaded grey), created/skipped counts and the time. Each row links to its page.
- If `canImport` is false, show "Ask an admin or supervisor to run imports" and nothing else.

**`/imports/[id]`:**

- **Status `uploaded`, WhatsApp** (the preview):
  - The counts: messages, issues, answered, attachments.
  - The date order as two radio buttons: "Day/Month (12/10 = 12 October)" and "Month/Day".
  - A sender table with a "Staff" checkbox per sender, prefilled.
  - A note: "Messages from staff become replies. Everyone else is a client."
  - The 5 sample issues.
  - A "Start import" button that POSTs start with the ticked staff and the order.
  - Changing staff ticks doesn't re-group the sample; say so in a light line: "The sample uses the ticks as first guessed."
- **Status `uploaded`, CSV** (the mapping):
  - A table with one row per field. Each row has a select of the CSV headers, plus "(not used)"; "Old ID" and "Question" are marked required.
  - The date order radio.
  - A preview table of the first 20 mapped rows, scrolling sideways on phones.
  - The good and bad counts.
  - "Start import" is disabled until Old ID and Question are mapped.
- **Status `queued` or `running`:**
  - A progress line, for example "Imported 200 of 640 issues…", from `progress` and `stats`.
  - Poll every 5 s.
- **Status `done`:**
  - The final stats.
  - Links:
    - "See tickets", which goes to `/tickets?projectId=…&status=all`;
    - "Review Library drafts (n)", which goes to `/knowledge/drafts?projectId=…`.
  - For CSV with bad rows: a "Download bad rows" button.
  - When images were imported: "N screenshots are being checked for IC numbers in the background."
- **Status `failed`:** show the error, plus "Try again", which re-queues the job: `POST start` is allowed from `failed`. Add that to the API and its tests.

Every screen:
- uses only the allowed text tokens;
- works at 390;
- shows errors and disables buttons while busy.

**Nav:**
- Under Sources, make a section group "Sources" with "Channels" (`/channels`) and "Imports" (`/imports`), the same way the "Clients" group was done in 2A.
- The top-level Sources item keeps `/channels` and matches both.
- Update `tests/unit/nav-items.test.ts`.
- Add `"/imports"` to `scripts/smoke-pages.mjs`.

- [ ] **Step 3: Check and commit**

Run `npx tsc --noEmit`, `npx vitest run`, `npm run lint` and `npm run smoke`.

Check by hand with puppeteer as admin. Log in once and save screenshots at 1280 and 390 to `.superpowers/screens-3b/`. Run both flows:
1. **WhatsApp:** upload `tests/fixtures/wa/android-en.txt` to the default project. On the preview, tick "Support Ali" as staff and start. Run `npm run worker -- --once`, check the done page, then open the tickets link.
2. **CSV:** upload a small CSV with one bad row. Map the columns, start, run the worker, then download the bad rows.

Afterwards, delete the imported tickets through the API, and the drafts through the drafts API from Task 8. Alternatively, note the cleanup is left for Task 8 and do it then.

```bash
git add src/app/(dashboard)/imports src/components/layout/nav-items.ts tests scripts src/app/api/company src/lib/hooks/use-company.ts src/app/api/imports
git commit -m "import screens for whatsapp chats and csv"
```

---

### Task 8: Library > Waiting approval

**Files:**
- Create:
  - `src/app/api/knowledge/drafts/route.ts`
  - `src/app/api/knowledge/drafts/[id]/route.ts`
  - `src/app/(dashboard)/knowledge/drafts/page.tsx`
  - `tests/api/knowledge-drafts.test.ts`
- Modify:
  - `src/app/api/knowledge/entries/route.ts` (list only approved by default)
  - `src/components/layout/nav-items.ts` and its test
  - `scripts/smoke-pages.mjs`
  - `CHANGELOG.md`

**Interfaces:**
- Produces (HTTP):
  - `GET /api/knowledge/drafts?projectId=&page=` → paginated drafts. Each draft has `id, title, content, projectId, project { name }, sourceTicketId, sourceTicket { number }, createdAt`. Drafts are limited to projects the user can see (`projectWhere`).
  - `PATCH /api/knowledge/drafts/:id` with `{ title?, content?, categoryId? }` edits a draft. Title and content are IC-masked.
  - `POST /api/knowledge/drafts/:id` with `{ action: "approve" }` sets `status: "approved"` and `isActive: true`. With `{ action: "reject" }` it deletes the draft.
  - `GET /api/knowledge/drafts?count=1` → `{ count }`, used for the nav badge.
- Permissions:
  - reading drafts needs `knowledge:read`;
  - approving, editing or rejecting needs `knowledge:update`;
  - rejecting also needs `knowledge:delete`; use the stricter permission for reject.

- [ ] **Step 1: API tests first**

Create `tests/api/knowledge-drafts.test.ts`. It covers:
- **List:**
  - asks for `knowledge:read`;
  - filters `status: "draft"` and the project scope for staff;
  - returns pagination.
- **Approve:**
  - sets `{ status: "approved", isActive: true }`;
  - returns 404 for a draft outside the user's projects;
  - returns 409 for an entry that is already approved.
- **Edit:** masks an IC in the content.
- **Reject:** deletes the draft and asks for `knowledge:delete`.
- **Entries list:** `GET /api/knowledge/entries` now adds `status: "approved"` to its where, so drafts never show among normal articles.

- [ ] **Step 2: Routes and page**

Implement the routes. Each one loads the draft with `findFirst({ where: { id, status: "draft", ...projectWhere(ids) } })`, where `projectWhere` includes entries with a null `projectId` only for see-all roles.

Build `/knowledge/drafts` (Header "Waiting approval", description "Answers from imports. Approve the good ones so the AI can use them."):
- A project filter select (it reads `?projectId=` from the URL), and cards. Each card shows:
  - the title;
  - "From ticket #n" linking to the ticket;
  - the project;
  - the content: Q and A, each clamped to 6 lines with a "Show more" toggle.
- Card buttons:
  - "Approve" (primary);
  - "Edit", which turns the title and content into inputs and adds Save and Cancel;
  - "Reject", which asks for confirmation first.
- Buttons are disabled while busy. Errors show inline.
- An empty state: "Nothing waiting. Imported answers show up here."
- The page works at 390.

Nav: in the Library section group, add `{ name: "Waiting approval", href: "/knowledge/drafts" }` after "Articles". Update the nav test and add the page to the smoke pages.

- [ ] **Step 3: Changelog and final checks**

Add to CHANGELOG `[Unreleased]` > Changed: "Imports: WhatsApp chat exports (.txt or .zip with images) and old-system CSV become tickets, with IC numbers hidden. Re-imports skip what's already in. Answers wait in Library > Waiting approval before the AI can use them."

Add to Upgrade notes:
- "Imports run in the worker. Keep `npm run worker` running."
- "Import uploads are limited to 50 MB. Export big chats without media or in parts."

Run `npx tsc --noEmit`, `npx vitest run`, `npm run test:integration`, `npm run lint` and `npm run smoke`.

Stop the dev server, run `npx next build` (it must succeed), then restart the dev server.

Check by hand with puppeteer at 1280 and 390. After the Task 7 WhatsApp import:
1. Open Waiting approval and see the draft.
2. Edit it, approve it, and check it appears in Articles.
3. Reject another draft.

Then clean up all test data: tickets through the API, and drafts and entries through their APIs.

```bash
git add src/app/api/knowledge src/app/(dashboard)/knowledge/drafts src/components/layout/nav-items.ts tests scripts CHANGELOG.md
git commit -m "library drafts waiting for approval"
```

---

## Done when

**Checks pass:** `npx vitest run`, `npm run test:integration`, `npx tsc --noEmit`, `npm run lint` (0 errors), `npm run smoke` and `npx next build`.

**Behaviour:**
- A WhatsApp `.txt` or `.zip` export is turned into tickets per issue.
  - Answered issues are closed. Unanswered ones are open when they're recent, closed otherwise.
  - Text, names and file names are IC-masked.
  - Staff senders are chosen in the preview and remembered.
  - Images become screenshots that the worker checks for IC numbers.
  - Re-importing the same or an overlapping export skips what's already in.
- A CSV is mapped once (the mapping is remembered).
  - The first 20 rows are previewed.
  - Rows are imported as closed tickets with their answers.
  - Bad rows are listed and can be downloaded.
  - Re-imports skip by old ID.
- Imports send no emails and set no SLA times.
- Every answered issue becomes a Library draft. Drafts are only used by the AI after approval in Library > Waiting approval.

**Before merge:** one real Android export and one real iPhone export from the user, with names redacted, parse correctly. Add each as a fixture test. If a format fails, fix the parser and add the case.

**Not in this plan:**
- the silent WhatsApp bot (3C);
- the AI using Library entries per project (4);
- Excel files (CSV only, by decision);
- videos, voice notes and documents from exports (counted and skipped).
