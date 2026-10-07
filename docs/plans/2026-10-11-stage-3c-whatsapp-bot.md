# Stage 3C: Silent WhatsApp Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each company links one WhatsApp number by QR. The bot then listens in the groups (and private chats) it's in and turns client messages into tickets. Staff replies become answers. The bot never sends anything.

**Architecture:**
- The bot lives in the `worker` process, with one whatsapp-web.js client per company. Its state is kept on the company's `Channel` row (`type: "whatsapp"`), so the web app and worker talk only through the database:
  - the web app asks for "start" or "stop";
  - the worker writes the QR, the status and a heartbeat.
- Every incoming message is IC-masked and saved straight away as a `WaInbound` row.
- A worker job, `bot intake`, runs every minute and turns those rows into tickets:
  - client messages, once the sender has been quiet for 2 minutes;
  - staff replies, using the quoted message or simple rules;
  - unclear replies go to a "Replies to place" list.
- The old in-server WhatsApp client and every sending path are deleted.

**Tech Stack:** whatsapp-web.js (already installed, LocalAuth sessions in `.wwebjs_auth`), Prisma 7 with the tenant extension, the existing worker loop, the 3A attachments pipeline, the email outbox, Vitest.

Spec: `docs/specs/2026-10-04-helplus-design.md`, section "3. Intake", "Silent WhatsApp bot", and the Errors table row "Bot disconnects".

## Global Constraints

- **Naming:** code name `helplus`, display name "Help+". No "owly" anywhere except `LICENSE`.
- **Comments:** only when needed. One short plain line, written the way a person would. No multi-line explanations, no emoji.
- **Commits:** short, lowercase messages. No Co-Authored-By trailer. Commit locally by explicit path (`git add <paths> && git commit -m "..." -- <paths>`). Never push or open a PR.
- **Before every commit:** `npx vitest run`, `npx tsc --noEmit` and `npm run test:integration` all pass. A UI task's last commit also passes `npm run lint` (0 errors) and `npm run smoke`.
- **Look:**
  - Indigo `#3B3FA6`, warm greys, IBM Plex, lucide icons, no emoji.
  - Text colours are only `text-helplus-{text,text-light,link,danger,success,warning}`, plus `text-white` on primary buttons.
  - Every screen works at 390px.
- **Data access:**
  - Every query goes through the scoped `prisma`. `systemPrisma` is only for looping over companies in the worker.
  - Writes use scalar foreign keys, never `connect`. The link check runs outside transactions.
- **Read-only bot.** No code may call `sendMessage`, `reply`, `sendSeen`, `sendStateTyping`, `react`, `forward` or any other method that writes to WhatsApp. A guard test enforces this. `whatsapp-web.js` is imported in exactly one file, `src/lib/bot/client.ts`.
- **Privacy:**
  - Every stored text from the bot is IC-masked with `maskIC`. That covers message text, sender names, chat names and file names.
  - Images are stored encrypted (`encryptBuffer`) until they're attached to a ticket, then go through the 3A screenshot pipeline (`addAttachment`).
- **Live tickets.** Bot tickets are normal tickets: `openTicket` gives them SLA times and sends the new-ticket email.
- **Local databases:**
  - Dev db `helpplus`, test db `helpplus_test`, user `helpplus`, password `helpplus_dev_2026`.
  - psql is in `/c/ServBay/packages/postgresql/18/bin/`.
- **Dev server** runs on :3000.
  - Stop it before `prisma generate` or `next build` with PowerShell: `Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess -Force -Confirm:$false`.
  - Restart it with `cd /d/development/helpdeskAI2 && (nohup npm run dev > ../helpdeskAI2-dev.log 2>&1 &)`.
- **Logins** are rate limited to 5 per minute per IP. Puppeteer scripts log in once.

---

## Decisions this plan makes

User decisions (2026-10-07):
- **The bot replaces the old WhatsApp connection.** The old in-server client is deleted, including its AI auto-reply and all sending code. Private chats to the bot number are also recorded silently.
- **A staff reply without a quote is matched by rules in this stage.** If the group has exactly one open ticket active in the last 4 hours, the reply goes there. Otherwise it waits in "Replies to place". AI picking comes in stage 4.
- **Groups that aren't linked** show under Sources as "Not linked". Their messages are ignored until an admin links the group to a client or project.

Made here:
- **Private chats** are linked automatically to the sender's customer project, or else to the default project. Admins can change that.
- **Staff are recognised** when either is true:
  - the sender's number matches a Settings > Team member's phone (digits only, a leading `0` becomes `60`);
  - the sender's masked display name is marked staff in `ChatSender`. That's the same table imports use, and the group page can toggle it.

  The bot's own number is never staff.
- **One open ticket per client per chat.**
  - A client message that comes within 4 hours of their open ticket's last activity joins that ticket.
  - A client message that quotes a message on one of their tickets joins that ticket.
  - Otherwise the client's messages wait for 2 quiet minutes and then become a new ticket.
- **A staff message arriving forces pending client messages before it to be processed first,** so an answer never lands before its question exists.
- **Answered.** A staff answer on a ticket in `new`, `ai_suggested`, `working` or `reopened` moves it to `answered` via `saveTicket` + `statusChange`. A follow-up from the client on an answered ticket moves it to `working`. This is the same rule as `ticketForIncomingMessage`.
- **Timing.** The intake job runs in the worker every minute, so "about 2 minutes" really means 2 to 3 minutes.
- **Retention.** `WaInbound` rows that are done, ignored or placed are deleted after 7 days. Their stored media is deleted as soon as it's attached, or when the row is deleted.
- **Live updates.** Live screens don't update from the worker, because realtime only exists inside the web process. New bot tickets show when the list reloads. The ticket list already reloads on focus and filter change; check that and note it in the CHANGELOG.
- **Disconnects.**
  - When the client fires `disconnected`, or `auth_failure` after it had been connected:
    - the Channel status becomes `disconnected`;
    - every admin and owner with an email gets one email (kind `bot_disconnected`);
    - the card shows red.
  - If the worker stops sending heartbeats for more than 3 minutes, the card shows red with "Worker not running", but no email is sent.
- **Unlink.** "Unlink" logs the session out (`client.logout()`) and deletes the saved session. "Stop" only stops the client, and the next start reuses the session without a QR.
- **Permissions:**
  - Connecting, unlinking and the QR need `channels:update` (admin, owner).
  - Linking groups, toggling staff and placing replies need `channels:read` (supervisor, admin, owner). Placing replies also needs `tickets:update`; check the exact permission name in `src/lib/rbac.ts`.

## Channel row protocol (`Channel` where `type = "whatsapp"`)

`status` is one of:

| status | set by | meaning |
|---|---|---|
| `off` | web (stop done), worker | not running |
| `starting` | web (Connect) | worker should start the client |
| `qr` | worker | waiting for a scan; `config.qr` holds a data URL |
| `connected` | worker | running |
| `disconnected` | worker | dropped; emails were sent; Connect starts it again |
| `stopping` | web (Stop or Unlink) | worker should stop it; `config.unlink` is true for Unlink |

`config` JSON holds:
- `qr?: string` and `qrAt?: string`;
- `seenAt?: string`: the worker heartbeat, every 15 s while running;
- `phone?: string`: the bot's own number, digits only;
- `error?: string`: a short, user-safe message;
- `unlink?: boolean`.

There are two writers, so every write merges `config`, never replaces it. The worker's status writes use `updateMany` with the status it expects in the `where`, so a Stop clicked during a start isn't overwritten.

---

## File map

| File | Does |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261011000000_whatsapp_bot/migration.sql` | `WaChat`, `WaInbound` |
| `src/lib/tenant/links.ts` | link rules for the new models |
| `src/lib/bot/rules.ts` | pure: sender digits, staff test, batching, reply placement |
| `src/lib/bot/record.ts` | save one incoming message (masked) |
| `src/lib/bot/intake.ts` | turn saved messages into tickets, answers and picks |
| `src/lib/bot/state.ts` | read and write the Channel row protocol |
| `src/lib/bot/client.ts` | the only whatsapp-web.js import: start or stop one company's client, map its events |
| `src/lib/bot/runtime.ts` | worker side: keep each company's client in line with its Channel row |
| `src/lib/jobs/bot.ts`, `src/lib/jobs/run.ts` | `bot intake` job and cleanup |
| `scripts/worker.ts` | start the bot runtime next to the job loop |
| `src/lib/notify/templates.ts`, `src/lib/notify/bot.ts` | disconnect email |
| `src/app/api/channels/whatsapp/route.ts` | rewritten: status, connect, stop, unlink |
| `src/app/api/bot/chats/route.ts`, `src/app/api/bot/chats/[id]/route.ts` | list chats, link a project |
| `src/app/api/bot/senders/route.ts` | list recent senders, toggle staff |
| `src/app/api/bot/picks/route.ts`, `src/app/api/bot/picks/[id]/route.ts` | replies to place |
| `src/app/(dashboard)/channels/page.tsx` | WhatsApp card rewritten |
| `src/app/(dashboard)/channels/whatsapp/page.tsx` | groups, senders, replies to place |
| deleted: `src/lib/channels/whatsapp.ts`, `tests/unit/channel-owner.test.ts`, `tests/api/channel-in-use.test.ts` | old client |

Task order:
- Task 1 first.
- Then Tasks 2 and 3 in parallel.
- Then Task 4, plus Task 5 in parallel with it.
- Then Task 6.
- Then Task 7.
- Task 8 last.

---

### Task 1: Tables for chats and incoming messages

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/tenant/links.ts`
- Create: `prisma/migrations/20261011000000_whatsapp_bot/migration.sql`
- Test: `tests/unit/tenant-links.test.ts` (existing; it must still pass), `tests/integration/bot-tables.test.ts`

**Interfaces:**
- Produces Prisma models `WaChat` and `WaInbound`, exactly as below.

- [ ] **Step 1: Back up the dev database**

```bash
mkdir -p .superpowers/backup && PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/pg_dump.exe -h localhost -U helpplus -d helpplus -Fc -f .superpowers/backup/helpplus-before-3c.dump
```

- [ ] **Step 2: Add the models to `prisma/schema.prisma`**

Add after `ImportJob`:

```prisma
// a whatsapp group or private chat the bot can see
model WaChat {
  id            String      @id @default(uuid())
  companyId     String
  company       Company     @relation(fields: [companyId], references: [id], onDelete: Cascade)
  waId          String
  name          String      @default("")
  isGroup       Boolean     @default(true)
  projectId     String?
  project       Project?    @relation(fields: [projectId], references: [id], onDelete: SetNull)
  lastMessageAt DateTime?
  inbound       WaInbound[]
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@unique([companyId, waId])
  @@index([companyId])
}

// one message the bot saw, IC hidden, waiting to become part of a ticket
model WaInbound {
  id          String    @id @default(uuid())
  companyId   String
  company     Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  chatId      String
  chat        WaChat    @relation(fields: [chatId], references: [id], onDelete: Cascade)
  waMessageId String
  senderId    String
  senderName  String    @default("")
  isStaff     Boolean   @default(false)
  text        String    @default("")
  at          DateTime
  quotedWaId  String?
  mediaKey    String?
  mediaName   String?
  state       String    @default("pending") // pending | done | pick | ignored
  ticketId    String?
  ticket      Ticket?   @relation(fields: [ticketId], references: [id], onDelete: SetNull)
  doneAt      DateTime?
  createdAt   DateTime  @default(now())

  @@unique([companyId, waMessageId])
  @@index([companyId, state])
  @@index([chatId, at])
}
```

Add the back-relations:
- `waChats WaChat[]` and `waInbound WaInbound[]` on `Company`;
- `waChats WaChat[]` on `Project`;
- `waInbound WaInbound[]` on `Ticket`.

- [ ] **Step 3: Write the migration by hand**

Run `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` after the schema edit, or write the SQL to match. Save it to `prisma/migrations/20261011000000_whatsapp_bot/migration.sql`.

It must:
- create both tables with the indexes and unique keys above;
- add foreign keys: `WaChat.companyId` (cascade), `WaChat.projectId` (set null), `WaInbound.companyId` (cascade), `WaInbound.chatId` (cascade) and `WaInbound.ticketId` (set null).

Apply it to the dev and test databases:

```bash
PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/psql.exe -h localhost -U helpplus -d helpplus -f prisma/migrations/20261011000000_whatsapp_bot/migration.sql
PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/psql.exe -h localhost -U helpplus -d helpplus -c "INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count) VALUES (gen_random_uuid(), 'manual', '20261011000000_whatsapp_bot', now(), 1)"
npx prisma db push --skip-generate
```

Expected output of the last command: "The database is already in sync with the Prisma schema."

The test database is migrated by the integration setup. Check `tests/integration/setup` (or `vitest.integration.config.ts`) to see how; if it runs `migrate deploy`, nothing else is needed.

Stop the dev server, run `npx prisma generate`, then restart it.

- [ ] **Step 4: Add the link rules to `src/lib/tenant/links.ts`**

In `LINKS`:

```ts
  WaChat: { projectId: "Project" },
  WaInbound: { chatId: "WaChat", ticketId: "Ticket" },
```

In `RELATIONS`:
- add `WaChat: { project: "Project", inbound: "WaInbound" }` and `WaInbound: { chat: "WaChat", ticket: "Ticket" }`;
- add `waChats: "WaChat"` to the existing `Project` entry and `waInbound: "WaInbound"` to the existing `Ticket` entry.

Keep the existing order style.

- [ ] **Step 5: Write the integration test**

`tests/integration/bot-tables.test.ts`, following the setup pattern of `tests/integration/imports-write.test.ts` (company helpers and `runWithCompany`):

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { makeCompany } from "./helpers"; // use the helper the other integration tests use

describe("bot tables", () => {
  it("keeps chats and messages per company", async () => {
    const a = await makeCompany("bot-a");
    const b = await makeCompany("bot-b");
    await runWithCompany(a, async () => {
      const chat = await prisma.waChat.create({ data: { waId: "120@g.us", name: "Kedai A" } });
      await prisma.waInbound.create({
        data: { chatId: chat.id, waMessageId: "m1", senderId: "60123456789@c.us", at: new Date() },
      });
    });
    await runWithCompany(b, async () => {
      expect(await prisma.waChat.count()).toBe(0);
      // same wa ids are fine in another company
      const chat = await prisma.waChat.create({ data: { waId: "120@g.us" } });
      await prisma.waInbound.create({ data: { chatId: chat.id, waMessageId: "m1", senderId: "x", at: new Date() } });
    });
  });

  it("refuses a duplicate message id in one company", async () => {
    const a = await makeCompany("bot-dup");
    await runWithCompany(a, async () => {
      const chat = await prisma.waChat.create({ data: { waId: "1@g.us" } });
      const row = { chatId: chat.id, waMessageId: "m1", senderId: "x", at: new Date() };
      await prisma.waInbound.create({ data: row });
      await expect(prisma.waInbound.create({ data: row })).rejects.toMatchObject({ code: "P2002" });
    });
  });
});
```

If the helper has a different name, use the one the other integration tests use and keep the assertions.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/tenant-links.test.ts && npm run test:integration -- tests/integration/bot-tables.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261011000000_whatsapp_bot src/lib/tenant/links.ts tests/integration/bot-tables.test.ts && git commit -m "tables for whatsapp bot chats and messages" -- prisma/schema.prisma prisma/migrations/20261011000000_whatsapp_bot src/lib/tenant/links.ts tests/integration/bot-tables.test.ts
```

---

### Task 2: Pure rules (batching, staff, placing replies)

**Files:**
- Create: `src/lib/bot/rules.ts`
- Test: `tests/unit/bot-rules.test.ts`

**Interfaces:**
- Produces:

```ts
export const QUIET_MS = 2 * 60_000;
export const FOLLOW_UP_MS = 4 * 3600_000;
export function senderDigits(waId: string): string; // "60123456789@c.us" -> "60123456789"
export function phoneDigits(phone: string): string; // "012-345 6789" -> "60123456789"
export function isStaffSender(s: { senderId: string; senderName: string }, staff: { phones: Set<string>; names: Set<string>; botPhone: string }): boolean;
export interface PendingMsg { id: string; senderId: string; isStaff: boolean; at: Date; quotedWaId: string | null }
export type Step =
  | { kind: "client"; senderId: string; ids: string[] }
  | { kind: "staff"; id: string };
export function plan(pending: PendingMsg[], now: Date): Step[];
export interface OpenTicketLite { id: string; lastActivityAt: Date }
export function placeUnquoted(open: OpenTicketLite[], at: Date): { ticketId: string } | "pick" | "ignore";
```

- [ ] **Step 1: Write the failing tests**

`tests/unit/bot-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { senderDigits, phoneDigits, isStaffSender, plan, placeUnquoted, QUIET_MS, FOLLOW_UP_MS } from "@/lib/bot/rules";

const t0 = new Date("2026-10-11T02:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const msg = (id: string, senderId: string, ms: number, isStaff = false, quotedWaId: string | null = null) => ({
  id, senderId, isStaff, at: at(ms), quotedWaId,
});

describe("numbers", () => {
  it("reads digits from wa ids and phones", () => {
    expect(senderDigits("60123456789@c.us")).toBe("60123456789");
    expect(phoneDigits("012-345 6789")).toBe("60123456789");
    expect(phoneDigits("+60 12-345 6789")).toBe("60123456789");
    expect(phoneDigits("")).toBe("");
  });
});

describe("isStaffSender", () => {
  const staff = { phones: new Set(["60123456789"]), names: new Set(["Support Ali"]), botPhone: "60111111111" };
  it("matches team phones and staff names", () => {
    expect(isStaffSender({ senderId: "60123456789@c.us", senderName: "Ali" }, staff)).toBe(true);
    expect(isStaffSender({ senderId: "60199999999@c.us", senderName: "Support Ali" }, staff)).toBe(true);
    expect(isStaffSender({ senderId: "60199999999@c.us", senderName: "Aminah" }, staff)).toBe(false);
  });
  it("never counts the bot itself", () => {
    expect(isStaffSender({ senderId: "60111111111@c.us", senderName: "Support Ali" }, staff)).toBe(false);
  });
});

describe("plan", () => {
  it("waits until a client has been quiet for 2 minutes", () => {
    const p = [msg("a", "c1", 0), msg("b", "c1", 30_000)];
    expect(plan(p, at(30_000 + QUIET_MS - 1))).toEqual([]);
    expect(plan(p, at(30_000 + QUIET_MS))).toEqual([{ kind: "client", senderId: "c1", ids: ["a", "b"] }]);
  });

  it("keeps clients apart", () => {
    const p = [msg("a", "c1", 0), msg("b", "c2", 10_000)];
    expect(plan(p, at(10 * 60_000))).toEqual([
      { kind: "client", senderId: "c1", ids: ["a"] },
      { kind: "client", senderId: "c2", ids: ["b"] },
    ]);
  });

  it("flushes earlier client messages before a staff message, even when not quiet", () => {
    const p = [msg("a", "c1", 0), msg("s", "st", 20_000, true), msg("b", "c1", 40_000)];
    expect(plan(p, at(50_000))).toEqual([
      { kind: "client", senderId: "c1", ids: ["a"] },
      { kind: "staff", id: "s" },
    ]);
  });

  it("handles staff messages in time order", () => {
    const p = [msg("s2", "st", 5_000, true), msg("s1", "st", 1_000, true)];
    expect(plan(p, at(6_000))).toEqual([{ kind: "staff", id: "s1" }, { kind: "staff", id: "s2" }]);
  });
});

describe("placeUnquoted", () => {
  it("uses the only ticket active in the last 4 hours", () => {
    expect(placeUnquoted([{ id: "t1", lastActivityAt: at(0) }], at(FOLLOW_UP_MS - 1))).toEqual({ ticketId: "t1" });
  });
  it("asks staff when there are several", () => {
    const open = [{ id: "t1", lastActivityAt: at(0) }, { id: "t2", lastActivityAt: at(1000) }];
    expect(placeUnquoted(open, at(2000))).toBe("pick");
  });
  it("ignores staff chatter with nothing open recently", () => {
    expect(placeUnquoted([], at(0))).toBe("ignore");
    expect(placeUnquoted([{ id: "t1", lastActivityAt: at(0) }], at(FOLLOW_UP_MS + 1))).toBe("ignore");
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/unit/bot-rules.test.ts`
Expected: FAIL, with "Cannot find module '@/lib/bot/rules'".

- [ ] **Step 3: Write `src/lib/bot/rules.ts`**

```ts
export const QUIET_MS = 2 * 60_000;
export const FOLLOW_UP_MS = 4 * 3600_000;

export function senderDigits(waId: string): string {
  return waId.split("@")[0].replace(/\D/g, "");
}

// local 0 numbers are malaysian
export function phoneDigits(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("0") ? `6${d}` : d;
}

export function isStaffSender(
  s: { senderId: string; senderName: string },
  staff: { phones: Set<string>; names: Set<string>; botPhone: string }
): boolean {
  const digits = senderDigits(s.senderId);
  if (digits && digits === staff.botPhone) return false;
  return staff.phones.has(digits) || staff.names.has(s.senderName);
}

export interface PendingMsg {
  id: string;
  senderId: string;
  isStaff: boolean;
  at: Date;
  quotedWaId: string | null;
}

export type Step = { kind: "client"; senderId: string; ids: string[] } | { kind: "staff"; id: string };

export function plan(pending: PendingMsg[], now: Date): Step[] {
  const sorted = [...pending].sort((a, b) => a.at.getTime() - b.at.getTime());
  const lastStaff = [...sorted].reverse().find((m) => m.isStaff)?.at.getTime() ?? -Infinity;
  const steps: Step[] = [];
  const batches = new Map<string, { kind: "client"; senderId: string; ids: string[] }>();
  const lastAt = new Map<string, number>();
  for (const m of sorted) if (!m.isStaff) lastAt.set(m.senderId, m.at.getTime());

  for (const m of sorted) {
    if (m.isStaff) {
      steps.push({ kind: "staff", id: m.id });
      // later client messages start a new batch after this reply
      batches.clear();
      continue;
    }
    // a staff reply after it means the question can't wait any longer
    const ready = m.at.getTime() < lastStaff || now.getTime() - lastAt.get(m.senderId)! >= QUIET_MS;
    if (!ready) continue;
    let b = batches.get(m.senderId);
    if (!b) {
      b = { kind: "client", senderId: m.senderId, ids: [] };
      batches.set(m.senderId, b);
      steps.push(b);
    }
    b.ids.push(m.id);
  }
  return steps;
}

export interface OpenTicketLite {
  id: string;
  lastActivityAt: Date;
}

export function placeUnquoted(open: OpenTicketLite[], at: Date): { ticketId: string } | "pick" | "ignore" {
  const recent = open.filter((t) => at.getTime() - t.lastActivityAt.getTime() < FOLLOW_UP_MS);
  if (recent.length === 1) return { ticketId: recent[0].id };
  return recent.length ? "pick" : "ignore";
}
```

In `plan`, a client batch is pushed at the position of its first ready message, so a client batch that comes before a staff step stays ahead of it. Check this against the "flushes earlier client messages" test. Message `b` (40 s) comes after the last staff message and isn't quiet yet, so it waits.

Add one more test: `[a(c1,0), s(staff,20s), b(c1,40s)]` with `now` = 40 s + `QUIET_MS` gives three steps in order: client `[a]`, staff `s`, client `[b]`. `b` must not join `a`'s batch.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/bot-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bot/rules.ts tests/unit/bot-rules.test.ts && git commit -m "bot rules for batching and placing replies" -- src/lib/bot/rules.ts tests/unit/bot-rules.test.ts
```

---

### Task 3: Save an incoming message

**Files:**
- Create: `src/lib/bot/record.ts`
- Modify: `src/lib/storage/index.ts` (add `botMediaKey`)
- Test: `tests/integration/bot-record.test.ts`

**Interfaces:**
- Consumes: `WaChat` and `WaInbound` (Task 1); `isStaffSender` and `phoneDigits` (Task 2); `maskIC`; `encryptBuffer` (check where `src/lib/attachments/service.ts` imports it from); `fileStore()`; `defaultProjectId()`.
- Produces:

```ts
export interface IncomingEvent {
  waMessageId: string;      // message.id._serialized
  chatWaId: string;         // "...@g.us" or "...@c.us"
  chatName: string;         // group subject or contact name
  isGroup: boolean;
  senderId: string;         // author for groups, from for private chats
  senderName: string;       // pushname || name || ""
  text: string;
  at: Date;
  quotedWaId: string | null;
  media: { data: Buffer; fileName: string; mime: string } | null;
}
export async function recordInbound(e: IncomingEvent, botPhone: string): Promise<"saved" | "duplicate" | "not_linked" | "skipped">;
export function botMediaKey(companyId: string, inboundId: string): string; // in storage/index.ts: c/<co>/bot/<id>.bin
```

Rules:
1. Upsert the `WaChat` by `waId`:
   - the name is IC-masked and cut to 200 characters;
   - set `lastMessageAt`;
   - the name is updated if it changed.
   - A new private chat (`isGroup: false`) is created with `projectId` set to the sender's customer project if a customer with that WhatsApp number exists and its project isn't archived. Otherwise it gets `defaultProjectId()`.
   - A new group gets `projectId: null`.
2. If the chat's `projectId` is null, return `"not_linked"`. Nothing else is saved.
3. Skip messages whose text is empty after trimming and that have no media. These are system and protocol messages; return `"skipped"`.
4. Staff check:
   - the phones are `TeamMember.phone` values passed through `phoneDigits`, empty ones dropped;
   - the names are `ChatSender` rows with `isStaff: true`;
   - both are loaded per call. Volumes are small; a per-company cache isn't needed now.
5. Create the `WaInbound`:
   - text: `maskIC(text).text`;
   - senderName: masked and cut to 120 characters;
   - `at`, `quotedWaId`, `isStaff`.
   - A P2002 on `(companyId, waMessageId)` returns `"duplicate"`.
6. Media: only images (`mime` starts with `image/`).
   - Store `encryptBuffer(data)` under `botMediaKey(companyId, row.id)`, then set `mediaKey` and `mediaName` on the row. The name goes through `maskedFileName` from attachments/service.
   - For other media (audio, video, documents), add a placeholder to `text`: `[voice message]`, `[video]` or `[document: <masked name>]`. Voice notes are `audio/ogg; codecs=opus`.

- [ ] **Step 1: Write the failing tests**

`tests/integration/bot-record.test.ts`. Use the same company helper as Task 1, and inside `runWithCompany`:

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { recordInbound, type IncomingEvent } from "@/lib/bot/record";
import { fileStore, botMediaKey } from "@/lib/storage";
import { makeCompany } from "./helpers";

const base = (over: Partial<IncomingEvent> = {}): IncomingEvent => ({
  waMessageId: "m1", chatWaId: "120@g.us", chatName: "Kedai Maju", isGroup: true,
  senderId: "60123456789@c.us", senderName: "Aminah", text: "printer rosak", at: new Date(),
  quotedWaId: null, media: null, ...over,
});

describe("recordInbound", () => {
  it("shows a new group but ignores its messages until linked", async () => {
    await runWithCompany(await makeCompany("rec-1"), async () => {
      expect(await recordInbound(base(), "60111111111")).toBe("not_linked");
      expect(await prisma.waChat.count()).toBe(1);
      expect(await prisma.waInbound.count()).toBe(0);
    });
  });

  it("saves masked text once a group is linked, and skips duplicates", async () => {
    await runWithCompany(await makeCompany("rec-2"), async () => {
      const project = await prisma.project.findFirstOrThrow();
      await recordInbound(base(), "60111111111");
      await prisma.waChat.updateMany({ data: { projectId: project.id } });
      expect(await recordInbound(base({ text: "IC saya 900101-14-5678" }), "60111111111")).toBe("saved");
      expect(await recordInbound(base({ text: "IC saya 900101-14-5678" }), "60111111111")).toBe("duplicate");
      const row = await prisma.waInbound.findFirstOrThrow();
      expect(row.text).toBe("IC saya [IC HIDDEN]");
      expect(row.isStaff).toBe(false);
    });
  });

  it("links a private chat to the default project straight away", async () => {
    await runWithCompany(await makeCompany("rec-3"), async () => {
      expect(await recordInbound(base({ chatWaId: "60123456789@c.us", isGroup: false }), "60111111111")).toBe("saved");
      const chat = await prisma.waChat.findFirstOrThrow();
      expect(chat.projectId).not.toBeNull();
    });
  });

  it("marks team members as staff and stores images encrypted", async () => {
    const co = await makeCompany("rec-4");
    await runWithCompany(co, async () => {
      const dept = await prisma.department.create({ data: { name: "Support" } });
      await prisma.teamMember.create({ data: { name: "Ali", email: "ali@x.my", phone: "012-345 6789", departmentId: dept.id } });
      const project = await prisma.project.findFirstOrThrow();
      await prisma.waChat.create({ data: { waId: "120@g.us", projectId: project.id } });
      const png = Buffer.from("89504e470d0a1a0a", "hex");
      await recordInbound(base({ media: { data: png, fileName: "a.png", mime: "image/png" } }), "60111111111");
      const row = await prisma.waInbound.findFirstOrThrow();
      expect(row.isStaff).toBe(true);
      expect(row.mediaKey).toBe(botMediaKey(co, row.id));
      const stored = await fileStore().get(row.mediaKey!);
      expect(stored.equals(png)).toBe(false); // encrypted
    });
  });

  it("skips empty system messages", async () => {
    await runWithCompany(await makeCompany("rec-5"), async () => {
      const project = await prisma.project.findFirstOrThrow();
      await prisma.waChat.create({ data: { waId: "120@g.us", projectId: project.id } });
      expect(await recordInbound(base({ text: "  " }), "x")).toBe("skipped");
    });
  });
});
```

Adjust the model field names (`department`, `teamMember`) to the schema if they differ. Keep the assertions.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm run test:integration -- tests/integration/bot-record.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Add the key helper to `src/lib/storage/index.ts`**

```ts
export function botMediaKey(companyId: string, inboundId: string): string {
  return `c/${companyId}/bot/${inboundId}.bin`;
}
```

- [ ] **Step 4: Write `src/lib/bot/record.ts`**

```ts
import { Prisma } from "@/generated/prisma/client"; // match the import other files use for Prisma errors
import { prisma } from "@/lib/prisma";
import { currentCompanyId } from "@/lib/tenant/context";
import { maskIC } from "@/lib/privacy/ic-mask";
import { defaultProjectId } from "@/lib/projects/default";
import { fileStore, botMediaKey } from "@/lib/storage";
import { encryptBuffer } from "@/lib/secrets"; // check the real export location
import { maskedFileName } from "@/lib/attachments/service";
import { isStaffSender, phoneDigits, senderDigits } from "./rules";

export interface IncomingEvent {
  waMessageId: string;
  chatWaId: string;
  chatName: string;
  isGroup: boolean;
  senderId: string;
  senderName: string;
  text: string;
  at: Date;
  quotedWaId: string | null;
  media: { data: Buffer; fileName: string; mime: string } | null;
}

const mask = (s: string, max: number) => maskIC(s).text.slice(0, max);

async function chatFor(e: IncomingEvent) {
  const name = mask(e.chatName, 200);
  const existing = await prisma.waChat.findFirst({ where: { waId: e.chatWaId } });
  if (existing) {
    return prisma.waChat.update({ where: { id: existing.id }, data: { name, lastMessageAt: e.at } });
  }
  const projectId = e.isGroup ? null : await privateChatProject(e.senderId);
  try {
    return await prisma.waChat.create({ data: { waId: e.chatWaId, name, isGroup: e.isGroup, projectId, lastMessageAt: e.at } });
  } catch (error) {
    // two messages from a new chat at once
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.waChat.findFirstOrThrow({ where: { waId: e.chatWaId } });
    }
    throw error;
  }
}

async function privateChatProject(senderId: string): Promise<string> {
  const digits = senderDigits(senderId);
  const customer = await prisma.customer.findFirst({
    where: { OR: [{ whatsapp: { contains: digits } }, { phone: { contains: digits } }], projectId: { not: null } },
    select: { projectId: true, project: { select: { archived: true } } },
  });
  return customer?.projectId && !customer.project?.archived ? customer.projectId : defaultProjectId();
}

function mediaNote(media: NonNullable<IncomingEvent["media"]>): string {
  if (media.mime.startsWith("audio/")) return "[voice message]";
  if (media.mime.startsWith("video/")) return "[video]";
  return `[document: ${maskedFileName(media.fileName)}]`;
}

export async function recordInbound(
  e: IncomingEvent,
  botPhone: string
): Promise<"saved" | "duplicate" | "not_linked" | "skipped"> {
  const chat = await chatFor(e);
  if (!chat.projectId) return "not_linked";
  const image = e.media?.mime.startsWith("image/") ? e.media : null;
  let text = e.text.trim();
  if (e.media && !image) text = `${mediaNote(e.media)} ${text}`.trim();
  if (!text && !image) return "skipped";

  const [team, senders] = await Promise.all([
    prisma.teamMember.findMany({ select: { phone: true } }),
    prisma.chatSender.findMany({ where: { isStaff: true }, select: { name: true } }),
  ]);
  const senderName = mask(e.senderName, 120);
  const isStaff = isStaffSender(
    { senderId: e.senderId, senderName },
    {
      phones: new Set(team.map((t) => phoneDigits(t.phone)).filter(Boolean)),
      names: new Set(senders.map((s) => s.name)),
      botPhone,
    }
  );

  let row;
  try {
    row = await prisma.waInbound.create({
      data: {
        chatId: chat.id,
        waMessageId: e.waMessageId,
        senderId: e.senderId,
        senderName,
        isStaff,
        text: maskIC(text).text,
        at: e.at,
        quotedWaId: e.quotedWaId,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "duplicate";
    throw error;
  }

  if (image) {
    const key = botMediaKey(currentCompanyId(), row.id);
    await fileStore().put(key, encryptBuffer(image.data));
    await prisma.waInbound.update({
      where: { id: row.id },
      data: { mediaKey: key, mediaName: maskedFileName(image.fileName || "whatsapp-image.jpg") },
    });
  }
  return "saved";
}
```

Before running:
- check the real `Prisma` error import path and the `encryptBuffer` export by grepping `src/lib/imports/write.ts` and `src/lib/attachments/service.ts`;
- check that the `fileStore().put` signature matches.

- [ ] **Step 5: Run the tests**

Run: `npm run test:integration -- tests/integration/bot-record.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bot/record.ts src/lib/storage/index.ts tests/integration/bot-record.test.ts && git commit -m "save bot messages with ic hidden" -- src/lib/bot/record.ts src/lib/storage/index.ts tests/integration/bot-record.test.ts
```

---

### Task 4: Turn saved messages into tickets (worker job)

**Files:**
- Create: `src/lib/bot/intake.ts`, `src/lib/jobs/bot.ts`
- Modify: `src/lib/jobs/run.ts`
- Test: `tests/integration/bot-intake.test.ts`

**Interfaces:**
- Consumes:
  - `plan`, `placeUnquoted`, `FOLLOW_UP_MS`, `senderDigits` (Task 2);
  - `WaInbound` rows (Task 3);
  - `openTicket`, `saveTicket`, `statusChange`, `OPEN_STATUSES`;
  - `resolveCustomer(channel, contact, name)` from `src/lib/customer-resolver.ts`;
  - `addAttachment` from attachments/service;
  - `decryptBuffer`, `fileStore`.
- Produces:

```ts
export async function runBotIntake(now: Date): Promise<{ tickets: number; answers: number; picks: number }>;
export async function placeReply(inboundId: string, ticketId: string | null, actorId?: string): Promise<"placed" | "ignored" | "gone">;
export async function cleanBotInbound(now: Date): Promise<number>; // deletes done/ignored rows older than 7 days and their media
```

How `runBotIntake` works, per `WaChat` with pending rows:

1. Load the chat's pending rows, oldest first, and run `plan(rows, now)`.
2. **Client step** (`senderId`, `ids`):
   - Customer: `resolveCustomer("whatsapp", senderId, senderName)`. If the customer has no `projectId`, set it to the chat's project.
   - Target ticket, checked in this order:
     - (a) any row in the batch has `quotedWaId` whose `Message` (`importKey = "wam:" + quotedWaId`) belongs to an open ticket of this chat for this customer;
     - (b) the customer's latest open ticket in this chat whose last activity is within `FOLLOW_UP_MS` of the batch's first message. "Last activity" here and in staff steps means the latest `at` of the `WaInbound` rows already done on that ticket. Never use `updatedAt`: it's wall-clock time, while message times come from WhatsApp, and mixing them breaks after a worker restart and in tests;
     - (c) otherwise, a new ticket.
   - A ticket "belongs to a chat" through its conversation: `Conversation.metadata.waChatId === chat.id`. Each bot ticket gets its own conversation with:
     - `channel: "whatsapp"`;
     - `customerName` set to the masked sender name;
     - `customerContact` set to `senderDigits(senderId)`;
     - `customerId`;
     - `metadata: { waChatId, waChatName }`.

     Use a JSON path filter `metadata: { path: ["waChatId"], equals: chat.id }`, and check that Prisma 7 with Postgres supports it as written.
   - New ticket:
     - create the conversation;
     - create one `customer` Message per row, with `importKey: "wam:" + waMessageId`;
     - then `openTicket({ conversationId, description: joined texts, source: chat.isGroup ? "whatsapp_group" : "whatsapp", projectId: chat.projectId })`.
   - Existing ticket:
     - create the Messages in its conversation;
     - if its status is `answered` or `ai_suggested`, `saveTicket(t, statusChange(t, "working"))`;
     - otherwise just touch `updatedAt`.
   - Images: for each row with `mediaKey`, `addAttachment({ ticketId, messageId, fileName: mediaName, data: decryptBuffer(stored) })` with processing on. Then remove the stored media and clear `mediaKey`.
   - Mark the rows `state: "done"`, `ticketId`, `doneAt: now`.
3. **Staff step** (one row):
   - **Quoted.** If the row has a quote and the quoted Message's conversation has an open ticket, the target is that ticket.
   - **Not quoted, or the quote was not found.** Collect this chat's open tickets as `{ id, lastActivityAt }`, where `lastActivityAt` is the max `at` of the done `WaInbound` rows on that ticket. Call `placeUnquoted(open, row.at)`:
     - `{ticketId}` gives the target;
     - `"pick"` sets `state: "pick"`;
     - `"ignore"` sets `state: "ignored"`.
   - **Target found:**
     - create an `agent` Message (`importKey: "wam:" + waMessageId`) in the ticket's conversation, plus any image;
     - if the status is `new`, `ai_suggested`, `working` or `reopened`, call `saveTicket(t, statusChange(t, "answered"))`;
     - mark the row done.
4. **Errors.** Each step runs in its own try/catch. On error, log it and leave the rows pending, so the next run retries. Don't stop other chats.
5. `placeReply(inboundId, ticketId)`:
   - with a ticket: does the same as a staff step with a known target. Refuse if the ticket isn't one of this chat's tickets (return `"gone"`).
   - with `ticketId` null: sets `state: "ignored"`.
   - Only rows in state `pick` are accepted. Claim the row with `updateMany({ where: { id, state: "pick" }, data: { state: "placing" } })`, and return `"gone"` when the count is 0.
6. Message `importKey` uniqueness makes a retried step safe:
   - catch P2002 per message, and skip it;
   - a retried client step must not open a second ticket. Before `openTicket`, check whether any of the batch's `wam:` keys already has a Message; if so, use that Message's conversation's ticket.

`src/lib/jobs/bot.ts`:

```ts
import { runBotIntake, cleanBotInbound } from "@/lib/bot/intake";

export async function runBot(now: Date): Promise<void> {
  await runBotIntake(now);
  await cleanBotInbound(now);
}
```

Register it in `src/lib/jobs/run.ts` `JOBS` as `["bot intake", runBot]`, placed before `"email"` so the new-ticket emails go out in the same run.

- [ ] **Step 1: Write the failing tests**

`tests/integration/bot-intake.test.ts`. Seed a linked chat and use `recordInbound` to add rows. Cover:

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { recordInbound, type IncomingEvent } from "@/lib/bot/record";
import { runBotIntake, placeReply, cleanBotInbound } from "@/lib/bot/intake";
import { makeCompany } from "./helpers";

const T = new Date("2026-10-11T02:00:00Z");
const min = (n: number) => new Date(T.getTime() + n * 60_000);
let n = 0;
const ev = (over: Partial<IncomingEvent>): IncomingEvent => ({
  waMessageId: `m${++n}`, chatWaId: "120@g.us", chatName: "Kedai", isGroup: true,
  senderId: "60199999999@c.us", senderName: "Aminah", text: "hello", at: T, quotedWaId: null, media: null, ...over,
});

async function setup(name: string) {
  const co = await makeCompany(name);
  await runWithCompany(co, async () => {
    const project = await prisma.project.findFirstOrThrow();
    await prisma.waChat.create({ data: { waId: "120@g.us", name: "Kedai", projectId: project.id } });
    await prisma.chatSender.create({ data: { name: "Support Ali", isStaff: true } });
  });
  return co;
}

describe("runBotIntake", () => {
  it("waits 2 quiet minutes, then opens one ticket with both messages", async () => {
    await runWithCompany(await setup("in-1"), async () => {
      await recordInbound(ev({ text: "printer rosak", at: min(0) }), "");
      await recordInbound(ev({ text: "dah restart", at: min(1) }), "");
      expect((await runBotIntake(min(2))).tickets).toBe(0);
      expect((await runBotIntake(min(3))).tickets).toBe(1);
      const t = await prisma.ticket.findFirstOrThrow({ include: { conversation: { include: { messages: true } } } });
      expect(t.source).toBe("whatsapp_group");
      expect(t.conversation!.messages.map((m) => m.content)).toEqual(["printer rosak", "dah restart"]);
      expect(t.slaDueAt ?? t.firstResponseDueAt).toBeTruthy(); // live ticket: use the real SLA field name
    });
  });

  it("a quoted staff reply answers that ticket", async () => {
    await runWithCompany(await setup("in-2"), async () => {
      await recordInbound(ev({ waMessageId: "q1", text: "printer rosak", at: min(0) }), "");
      await runBotIntake(min(3));
      await recordInbound(ev({ senderId: "60188888888@c.us", senderName: "Support Ali", text: "cuba tukar kabel", at: min(4), quotedWaId: "q1" }), "");
      expect((await runBotIntake(min(4))).answers).toBe(1);
      const t = await prisma.ticket.findFirstOrThrow();
      expect(t.status).toBe("answered");
      expect(t.firstReplyAt).not.toBeNull();
    });
  });

  it("a staff reply right after the question still lands after the ticket exists", async () => {
    await runWithCompany(await setup("in-3"), async () => {
      await recordInbound(ev({ text: "boleh tolong?", at: min(0) }), "");
      await recordInbound(ev({ senderName: "Support Ali", senderId: "60188888888@c.us", text: "ok", at: min(0.5) }), "");
      const r = await runBotIntake(min(1));
      expect(r).toMatchObject({ tickets: 1, answers: 1 });
    });
  });

  it("an unquoted reply with two open tickets waits for staff to place it", async () => {
    await runWithCompany(await setup("in-4"), async () => {
      await recordInbound(ev({ text: "a", at: min(0) }), "");
      await recordInbound(ev({ senderId: "60177777777@c.us", senderName: "Siti", text: "b", at: min(0) }), "");
      await runBotIntake(min(3));
      await recordInbound(ev({ senderName: "Support Ali", senderId: "60188888888@c.us", text: "done", at: min(4) }), "");
      expect((await runBotIntake(min(4))).picks).toBe(1);
      const pick = await prisma.waInbound.findFirstOrThrow({ where: { state: "pick" } });
      const ticket = await prisma.ticket.findFirstOrThrow();
      expect(await placeReply(pick.id, ticket.id)).toBe("placed");
      expect(await placeReply(pick.id, ticket.id)).toBe("gone");
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe("answered");
    });
  });

  it("a client follow-up after an answer moves the ticket back to working", async () => {
    await runWithCompany(await setup("in-5"), async () => {
      await recordInbound(ev({ waMessageId: "q", text: "x", at: min(0) }), "");
      await runBotIntake(min(3));
      await recordInbound(ev({ senderName: "Support Ali", senderId: "60188888888@c.us", text: "fixed", at: min(4), quotedWaId: "q" }), "");
      await runBotIntake(min(4));
      await recordInbound(ev({ text: "masih rosak", at: min(10) }), "");
      await runBotIntake(min(13));
      expect(await prisma.ticket.count()).toBe(1);
      expect((await prisma.ticket.findFirstOrThrow()).status).toBe("working");
    });
  });

  it("running twice never makes a second ticket", async () => {
    await runWithCompany(await setup("in-6"), async () => {
      await recordInbound(ev({ text: "x", at: min(0) }), "");
      await runBotIntake(min(3));
      await prisma.waInbound.updateMany({ data: { state: "pending" } }); // as if the run died before marking
      await runBotIntake(min(3));
      expect(await prisma.ticket.count()).toBe(1);
    });
  });

  it("cleans old done rows", async () => {
    await runWithCompany(await setup("in-7"), async () => {
      await recordInbound(ev({ text: "x", at: min(0) }), "");
      await runBotIntake(min(3));
      expect(await cleanBotInbound(new Date(min(3).getTime() + 8 * 86_400_000))).toBe(1);
      expect(await prisma.waInbound.count()).toBe(0);
    });
  });
});
```

Also add one test where a row has a stored image. It must end up as an `Attachment` on the ticket, and its `mediaKey` must be cleared.

The SLA assertion: use the real SLA due field on `Ticket`. Grep `slaTimes` in `src/lib/sla/clock.ts` for the field names.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npm run test:integration -- tests/integration/bot-intake.test.ts`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Write `src/lib/bot/intake.ts`**

Implement it exactly as the rules above say. Here's the skeleton; fill in each helper and keep each one small:

```ts
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { resolveCustomer } from "@/lib/customer-resolver";
import { openTicket } from "@/lib/tickets/service";
import { saveTicket } from "@/lib/tickets/update";
import { statusChange, OPEN_STATUSES } from "@/lib/tickets/status";
import { addAttachment } from "@/lib/attachments/service";
import { fileStore } from "@/lib/storage";
import { decryptBuffer } from "@/lib/secrets";
import { plan, placeUnquoted, senderDigits, FOLLOW_UP_MS, type Step } from "./rules";

const KEEP_MS = 7 * 86_400_000;
const ANSWERABLE = ["new", "ai_suggested", "working", "reopened"];
const key = (waMessageId: string) => `wam:${waMessageId}`;

type Row = Awaited<ReturnType<typeof prisma.waInbound.findFirstOrThrow>>;
type Chat = Awaited<ReturnType<typeof prisma.waChat.findFirstOrThrow>>;

export async function runBotIntake(now: Date) {
  const stats = { tickets: 0, answers: 0, picks: 0 };
  const chats = await prisma.waChat.findMany({
    where: { projectId: { not: null }, inbound: { some: { state: "pending" } } },
  });
  for (const chat of chats) {
    const rows = await prisma.waInbound.findMany({ where: { chatId: chat.id, state: "pending" }, orderBy: { at: "asc" } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const step of plan(rows, now)) {
      try {
        if (step.kind === "client") {
          if (await clientStep(chat, step.ids.map((id) => byId.get(id)!), now)) stats.tickets++;
        } else {
          const r = await staffStep(chat, byId.get(step.id)!, now);
          if (r === "answered") stats.answers++;
          if (r === "pick") stats.picks++;
        }
      } catch (error) {
        logger.error("bot intake step failed", error);
      }
    }
  }
  return stats;
}

// returns true when it opened a new ticket
async function clientStep(chat: Chat, rows: Row[], now: Date): Promise<boolean> {
  /* customer, find target (quote, recent open, existing wam key), else open ticket; messages; images; mark done */
}

async function staffStep(chat: Chat, row: Row, now: Date): Promise<"answered" | "pick" | "ignored"> {
  /* quoted target or placeUnquoted; answer() or set state */
}

async function answer(ticketId: string, row: Row, now: Date, actorId?: string): Promise<void> {
  /* agent message (P2002 skip), image, statusChange answered when ANSWERABLE, mark done */
}

export async function placeReply(inboundId: string, ticketId: string | null, actorId?: string) {
  /* claim pick row, check ticket belongs to the chat, answer() or ignore */
}

export async function cleanBotInbound(now: Date): Promise<number> {
  const old = await prisma.waInbound.findMany({
    where: { state: { in: ["done", "ignored"] }, doneAt: { lt: new Date(now.getTime() - KEEP_MS) } },
    select: { id: true, mediaKey: true },
    take: 500,
  });
  for (const r of old) if (r.mediaKey) await fileStore().remove(r.mediaKey).catch(() => {});
  const { count } = await prisma.waInbound.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
  return count;
}
```

Notes:
- `"ignored"` rows also get `doneAt: now`, so cleanup removes them.
- Pick rows have no `doneAt` until they're placed. `placeReply` sets it.
- Before writing each one, check the real signatures of `saveTicket`, `statusChange`, `resolveCustomer`, `addAttachment` and `decryptBuffer` (grep).
- `saveTicket(before, data, opts)` sends notify emails for reopen. Pass `{ actorId }` only when placing by a person.

- [ ] **Step 4: Register the job**

Edit `src/lib/jobs/run.ts`: import `runBot` from `./bot` and add `["bot intake", runBot]` before `["email", ...]`.

- [ ] **Step 5: Run the tests**

Run: `npm run test:integration -- tests/integration/bot-intake.test.ts && npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/bot/intake.ts src/lib/jobs/bot.ts src/lib/jobs/run.ts tests/integration/bot-intake.test.ts && git commit -m "bot intake job turns group messages into tickets" -- src/lib/bot/intake.ts src/lib/jobs/bot.ts src/lib/jobs/run.ts tests/integration/bot-intake.test.ts
```

---

### Task 5: The bot client in the worker (and the old client removed)

**Files:**
- Create: `src/lib/bot/state.ts`, `src/lib/bot/client.ts`, `src/lib/bot/runtime.ts`, `src/lib/notify/bot.ts`
- Modify:
  - `scripts/worker.ts`
  - `src/lib/notify/templates.ts` (add `"bot_disconnected"` to `EmailKind`)
  - `src/app/api/channels/whatsapp/route.ts` (rewrite)
  - `next.config.ts` (remove `whatsapp-web.js` from `serverExternalPackages` only if nothing in the Next app imports it any more; keep `puppeteer` if smoke or OCR need it)
- Delete: `src/lib/channels/whatsapp.ts`, `tests/unit/channel-owner.test.ts`, `tests/api/channel-in-use.test.ts`. Also remove `ChannelInUseError` if nothing else uses it.
- Test:
  - `tests/unit/bot-client.test.ts` (whatsapp-web.js mocked)
  - `tests/unit/bot-readonly.test.ts` (guard)
  - `tests/integration/bot-state.test.ts`
  - `tests/api/channels-whatsapp.test.ts`

**Interfaces:**
- Consumes: `recordInbound`, `IncomingEvent` (Task 3); `queueEmail`; the Channel model; `channelKey("whatsapp")`.
- Produces:

```ts
// state.ts, all inside runWithCompany
export type BotStatus = "off" | "starting" | "qr" | "connected" | "disconnected" | "stopping";
export interface BotState { status: BotStatus; qr: string | null; seenAt: Date | null; phone: string; error: string; unlink: boolean }
export async function readBot(): Promise<BotState>;
export async function requestStart(): Promise<boolean>;            // off|disconnected -> starting
export async function requestStop(unlink: boolean): Promise<boolean>; // starting|qr|connected -> stopping
export async function setBot(from: BotStatus[], to: BotStatus, config: Partial<{ qr: string | null; phone: string; error: string; unlink: boolean }>): Promise<boolean>; // conditional on current status
export async function heartbeat(now: Date): Promise<void>;
export const STALE_MS = 3 * 60_000;

// client.ts, the only whatsapp-web.js import
export interface BotHandle { stop(unlink: boolean): Promise<void> }
export async function startClient(companyId: string, hooks: {
  onQr(dataUrl: string): Promise<void>;
  onReady(phone: string): Promise<void>;
  onDown(reason: string): Promise<void>;
  onMessage(e: IncomingEvent): Promise<void>;
}): Promise<BotHandle>;

// runtime.ts
export async function syncBots(now: Date): Promise<void>; // reconcile every company's Channel row with running clients
export async function stopAllBots(): Promise<void>;

// notify/bot.ts
export async function emailBotDown(): Promise<number>; // queues one email per admin/owner with an email
```

How it works:

- **`client.ts`**
  - Creates `new Client({ authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth", clientId: companyId === "default" ? undefined : companyId }), puppeteer: { headless: true, args: [...same as before] } })`. Keep the same session folder rule, so a session that's already linked keeps working.
  - **`qr`:** `qrcode.toDataURL`, then `onQr`.
  - **`ready`:** `onReady(client.info.wid.user)`.
  - **`disconnected` and `auth_failure`:** `onDown(reason)`.
  - **`message`** (never `message_create`, so the bot's own sends, if any existed, are ignored):
    - map the message to an `IncomingEvent`:
      - `chat = await message.getChat()`;
      - `isGroup = chat.isGroup`;
      - `chatWaId = chat.id._serialized`;
      - `chatName = chat.name`;
      - `senderId = message.author ?? message.from`;
      - `senderName` from `(await message.getContact()).pushname || .name || ""`;
      - `quotedWaId` comes from `message.hasQuotedMsg ? (await message.getQuotedMessage()).id._serialized : null`;
      - media comes from `message.hasMedia ? await message.downloadMedia() : null`, as `Buffer.from(data, "base64")`, `filename`, `mimetype`;
      - `at = new Date(message.timestamp * 1000)`.
    - Skip `message.fromMe`, broadcast and status chats (`chatWaId === "status@broadcast"`), and messages where `message.isStatus` is set.
    - Any error is logged and swallowed.
  - **`stop(unlink)`:** `unlink ? await client.logout() : null`, then `await client.destroy()`. Both are guarded with try/catch.
  - The file must not call `sendMessage`, `reply`, `sendSeen` or any other write method.
- **`runtime.ts`**
  - Keeps a module map `companyId -> { handle, status }`.
  - `syncBots(now)`: for each company (`systemPrisma.company.findMany`), inside `runWithCompany`, read the bot state.
    - `starting`, or `connected`/`qr` with no running handle (a worker restart): start a client. On a start error, `setBot([...], "disconnected", { error: "Couldn't start WhatsApp" })` and email.
    - `stopping` with a handle: `handle.stop(state.unlink)`, then `setBot(["stopping"], "off", { qr: null, unlink: false, error: "" })`.
    - `stopping` with no handle: set it to `off`. If `unlink` is set, delete the session folder `.wwebjs_auth/session-<clientId>` (or `session` for default).
    - `off` or `disconnected` with a handle: stop it.
    - For each running and connected client, `heartbeat(now)`.
  - Hooks:
    - `onQr`: `setBot(["starting","qr"], "qr", { qr })`.
    - `onReady`: `setBot(["starting","qr","connected"], "connected", { qr: null, phone, error: "" })`.
    - `onDown`:
      1. Drop the handle.
      2. If `setBot(["connected","qr","starting"], "disconnected", { qr: null, error: "WhatsApp disconnected. Connect again from Sources." })` returns true, call `emailBotDown()`.
      3. A stop requested by the user, which sets `stopping` first, won't match, so it sends no email.
    - `onMessage`: `recordInbound(e, phone)` inside `runWithCompany`.
  - Every hook runs inside `runWithCompany(companyId, ...)`.
- **`scripts/worker.ts`**
  - Before the loop, start a 5-second timer that calls `syncBots(new Date())`, skipping if a previous sync is still running.
  - On stop, clear the timer and `await stopAllBots()` before `closeOcr()`. `stopAllBots` destroys clients without logging out or unlinking.
  - With `--once`: run `syncBots` once? No. In `--once` mode, don't start bots at all; the bot needs a long-running worker. Add one plain comment saying so.
- **`notify/bot.ts`**
  - Admins and owners with an email (`prisma.admin.findMany({ where: { role: { in: ["admin","owner"] }, email: { not: "" } } })`).
  - For each, `queueEmail({ to, subject: "WhatsApp bot disconnected", body, kind: "bot_disconnected" })`.
  - The body is two lines: "The WhatsApp bot for <company name> was disconnected. Open Sources > Channels and connect it again." and `${NEXT_PUBLIC_APP_URL}/channels`.
  - Get the company name the same way other emails do; check `notify.ts`.
  - Add `"bot_disconnected"` to `EmailKind`. Fix any `Record<Exclude<EmailKind, ...>>` maps and `recipientsFor` types that break. That kind isn't ticket-based, so exclude it there the way `"close_warning"` is.
- **`src/app/api/channels/whatsapp/route.ts`**
  - `GET` (`channels:read`) returns `{ status, stale, phone, error, seenAt, qr }`:
    - `qr` only for callers with `channels:update`, otherwise null;
    - `stale = status === "connected" && (!seenAt || now - seenAt > STALE_MS)`.
  - `POST` (`channels:update`) takes `{ action: "connect" | "stop" | "unlink" }`:
    - `connect` calls `requestStart()` and returns 409 "Already running" when it returns false;
    - `stop` and `unlink` call `requestStop(action === "unlink")`, with 409 when nothing is running;
    - an unknown action returns 400.
  - Return the new state.
  - Also add `PUT` returning 405 `{ error: "Use connect, stop or unlink" }`, so the old card's Save gets a clear answer until Task 7 replaces the card.

- [ ] **Step 1: Write the guard test first**

`tests/unit/bot-readonly.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WRITES = /\.(sendMessage|reply|sendSeen|sendStateTyping|sendStateRecording|react|forward|sendMediaMessage|setStatus|createGroup|addParticipants|leave)\s*\(/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

describe("whatsapp bot is read-only", () => {
  const all = [...files("src"), ...files("scripts")];

  it("imports whatsapp-web.js in one place only", () => {
    const users = all.filter((f) => readFileSync(f, "utf8").includes("whatsapp-web.js"));
    expect(users.map((f) => f.replace(/\\/g, "/"))).toEqual(["src/lib/bot/client.ts"]);
  });

  it("never calls a whatsapp write method", () => {
    const text = readFileSync("src/lib/bot/client.ts", "utf8");
    expect(text).not.toMatch(WRITES);
  });

  it("the old client is gone", () => {
    expect(all.some((f) => f.replace(/\\/g, "/").endsWith("src/lib/channels/whatsapp.ts"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/bot-readonly.test.ts`
Expected: FAIL. The old `src/lib/channels/whatsapp.ts` still imports `whatsapp-web.js` and calls `reply` and `sendMessage`.

- [ ] **Step 3: Write the remaining failing tests**

- **`tests/unit/bot-client.test.ts`:** mock `whatsapp-web.js` the way the deleted `channel-owner.test.ts` did; read it before deleting it. Check:
  - `startClient` passes `clientId` = the company id, and undefined for `"default"`;
  - a `qr` event calls `onQr` with a data URL;
  - a group `message` event calls `onMessage` with `isGroup: true`, `senderId` = `author` and `quotedWaId` from the quoted message;
  - `fromMe` and `status@broadcast` messages are skipped;
  - `stop(true)` calls `logout` then `destroy`;
  - `stop(false)` only calls `destroy`.
- **`tests/integration/bot-state.test.ts`:**
  - `requestStart` from `off` returns true and sets `starting`; a second call returns false;
  - `setBot(["starting"], "qr", {qr})` works; `setBot(["starting"], "connected", ...)` while the status is `stopping` returns false and changes nothing;
  - `config` merges: `setBot` with `{ phone }` keeps `qr` unless it's given;
  - `emailBotDown` queues one email per admin or owner that has an email, with kind `bot_disconnected`.
- **`tests/api/channels-whatsapp.test.ts`** (mocked prisma, following other `tests/api` files):
  - supervisor GET gets `qr: null`; admin GET gets the qr;
  - `stale` is true when `seenAt` is 4 minutes old;
  - POST connect from `off` gives 200 with `starting`; from `connected` it gives 409;
  - POST unlink sets `stopping` with `unlink: true`;
  - a supervisor POST gets 403.

- [ ] **Step 4: Implement**

Write `state.ts`, `client.ts`, `runtime.ts`, `notify/bot.ts` and the route as described. Then:
- delete `src/lib/channels/whatsapp.ts` and the two old tests;
- update `scripts/worker.ts`.

`state.ts` conditional write. Prisma can't merge JSON in one statement, so read and write with a status guard:

```ts
export async function setBot(from: BotStatus[], to: BotStatus, patch: Partial<Config> = {}): Promise<boolean> {
  const row = await prisma.channel.findUnique({ where: channelKey("whatsapp") });
  const status = (row?.status ?? "off") as BotStatus;
  if (!from.includes(status)) return false;
  const config = { ...((row?.config as Config) ?? {}), ...patch };
  if (!row) {
    await prisma.channel.create({ data: { type: "whatsapp", status: to, isActive: to === "connected", config } });
    return true;
  }
  const { count } = await prisma.channel.updateMany({
    where: { id: row.id, status, updatedAt: row.updatedAt },
    data: { status: to, isActive: to === "connected", config },
  });
  return count === 1;
}
```

`requestStart` is `setBot(["off", "disconnected"], "starting", { qr: null, error: "", unlink: false })`. Map the legacy statuses `"connected"`, `"disconnected"` and `"error"` from old rows: treat `"error"` and unknown values as `"off"`.

`heartbeat` writes `config.seenAt` with the same read-then-`updateMany` guard on `status: "connected"`.

- [ ] **Step 5: Run everything**

Run: `npx vitest run && npx tsc --noEmit && npm run test:integration`
Expected: PASS, with the guard test green.

Then run `npm run worker -- --once`. Expected: exit 0, and it doesn't try to start WhatsApp.

- [ ] **Step 6: Manual check (no phone needed)**

1. Start the worker in the background: `npm run worker > ../worker.log 2>&1 &`.
2. With the dev server up, log in as admin and `POST /api/channels/whatsapp {"action":"connect"}`.
3. Poll `GET` every 5 s for up to 60 s. Expected: status `starting`, then `qr`, with a `data:image/png` QR.
4. `POST {"action":"stop"}`. Expected: status becomes `off` within about 10 s.
5. Kill the worker.

Report the observed statuses. Don't scan the QR.

- [ ] **Step 7: Commit**

```bash
git add -A src/lib/bot src/lib/notify scripts/worker.ts src/app/api/channels/whatsapp next.config.ts tests/unit/bot-client.test.ts tests/unit/bot-readonly.test.ts tests/integration/bot-state.test.ts tests/api/channels-whatsapp.test.ts src/lib/channels/whatsapp.ts tests/unit/channel-owner.test.ts tests/api/channel-in-use.test.ts src/lib/errors.ts
git commit -m "silent whatsapp bot runs in the worker, old client removed" -- src/lib/bot src/lib/notify scripts/worker.ts src/app/api/channels/whatsapp next.config.ts tests/unit/bot-client.test.ts tests/unit/bot-readonly.test.ts tests/integration/bot-state.test.ts tests/api/channels-whatsapp.test.ts src/lib/channels/whatsapp.ts tests/unit/channel-owner.test.ts tests/api/channel-in-use.test.ts src/lib/errors.ts
```

`-A` is limited to these paths so the deletions are staged. Drop `src/lib/errors.ts` from both lists if it didn't change.

---

### Task 6: API for chats, staff senders and replies to place

**Files:**
- Create:
  - `src/app/api/bot/chats/route.ts`
  - `src/app/api/bot/chats/[id]/route.ts`
  - `src/app/api/bot/senders/route.ts`
  - `src/app/api/bot/picks/route.ts`
  - `src/app/api/bot/picks/[id]/route.ts`
- Test: `tests/api/bot-api.test.ts`

**Interfaces:**
- Consumes: `WaChat`, `WaInbound`, `ChatSender`; `placeReply` (Task 4); `projectProblem` from `src/lib/projects/usable.ts`; `allowedProjectIds`/`projectWhere` from `src/lib/tickets/access.ts`.
- Produces this HTTP contract, used by Task 7:

| Route | Permission | Does |
|---|---|---|
| `GET /api/bot/chats` | `channels:read` | `{ data: [{ id, name, isGroup, projectId, projectName, lastMessageAt, pending, picks }] }`, newest `lastMessageAt` first. Not-linked groups are included. Limited roles only see chats in their projects plus not-linked ones; check `allowedProjectIds`. |
| `PATCH /api/bot/chats/[id]` | `channels:read` | Body `{ projectId: string \| null }`. `projectProblem` refuses an archived or missing project. Unlinking (null) sets its pending rows to `ignored`. Returns the chat. |
| `GET /api/bot/senders?chatId=` | `channels:read` | Distinct senders from the last 30 days of `WaInbound` for that chat: `{ data: [{ name, staff, lastAt }] }`. `staff` comes from `ChatSender.isStaff` by name. Phone-matched staff show `staff: true` with `fromTeam: true`. |
| `PATCH /api/bot/senders` | `channels:read` | Body `{ name, staff: boolean }`. Upserts `ChatSender { name (masked), isStaff }`. Only future messages change. |
| `GET /api/bot/picks` | `channels:read` | `{ data: [{ id, chatName, senderName, text, at, options: [{ ticketId, number, title, status }] }] }`. The options are the chat's open tickets, newest activity first, at most 10. |
| `POST /api/bot/picks/[id]` | `channels:read` + `tickets:update` | Body `{ ticketId: string \| null }`. Calls `placeReply(id, ticketId, auth.adminId)`. `"gone"` gives 409 "Someone already placed this reply". `"placed"` and `"ignored"` give 200. |

Check the exact permission names for tickets in `src/lib/rbac.ts`. `withAuth` takes one permission; check the second one with `hasPermission(auth.role, ...)` inside the handler, the way Task 8 of 3B did for reject.

- [ ] **Step 1: Write the failing tests**

`tests/api/bot-api.test.ts`, following the mocked-prisma pattern of `tests/api/knowledge-drafts.test.ts`. It must cover:
- list chats (shape and order);
- PATCH link to a valid project;
- PATCH to an archived project gives 400 with `projectProblem`'s message;
- unlinking ignores pending rows (`updateMany` called with `state: "pending"` → `"ignored"`);
- senders list marks staff;
- PATCH senders upserts with a masked name (`"Ali 900101-14-5678"` becomes `"Ali [IC HIDDEN]"`);
- picks list;
- POST pick placed (200), gone (409), and a staff role without `tickets:update` (403);
- viewer GET gives 403.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run tests/api/bot-api.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the five route files** as the table says. Wrap every handler in `withAuth`, and use only the scoped `prisma`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/api/bot-api.test.ts && npx vitest run && npx tsc --noEmit`
Expected: PASS. The route-guard unit test must stay green.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/bot tests/api/bot-api.test.ts && git commit -m "bot api for groups, staff senders and replies to place" -- src/app/api/bot tests/api/bot-api.test.ts
```

---

### Task 7: Sources screens

**Files:**
- Modify: `src/app/(dashboard)/channels/page.tsx` (rewrite `WhatsAppCard`), `scripts/smoke-pages.mjs`
- Create: `src/app/(dashboard)/channels/whatsapp/page.tsx`
- Test: `tests/unit/bot-card.test.ts` (pure helper only, see below)

**Interfaces:**
- Consumes the Task 5 and Task 6 HTTP contracts.

**What to build:**

1. **WhatsApp card on `/channels`.** Replace the old web/API mode toggle, the API key fields and Save.
   - Title "WhatsApp bot", with the subtitle "Reads your groups and turns client messages into tickets. It never sends anything."
   - Status line with a dot and text from `botLabel(state)`. Put this pure helper in `src/app/(dashboard)/channels/bot-label.ts` and unit-test it:

     | state | label | colour |
     |---|---|---|
     | `connected` and not stale | "Connected as +<phone>" | success |
     | `connected` and stale | "Worker not running" | danger |
     | `qr` | "Scan the QR code" | warning |
     | `starting` | "Starting…" | text-light |
     | `stopping` | "Stopping…" | text-light |
     | `disconnected` | "Disconnected" + the error | danger |
     | `off` | "Not connected" | text-light |

   - Buttons, by status:
     - `off` or `disconnected`: "Connect";
     - `starting`, `qr` or `connected`: "Stop" and "Unlink number".
     - Unlink asks for confirmation: "This logs the bot out. You'll need to scan a new QR code."
     - The buttons are hidden for roles without `channels:update`. Read the role the same way the drafts page does (`/api/auth`).
   - The QR image shows when the status is `qr` and `qr` isn't null. Under it: "WhatsApp > Linked devices > Link a device".
   - Poll GET every 3 s while the status is `starting`, `qr` or `stopping`, and every 30 s otherwise. Clear the timer on unmount.
   - A "Before you connect" note with three short lines:
     - "Use a separate number just for the bot."
     - "Never make the bot the only group admin."
     - "Tell each group the bot is there."
   - A link "Groups and replies" to `/channels/whatsapp`, shown with a count badge of picks when there are any.
2. **`/channels/whatsapp` page.**
   - Header "WhatsApp groups", with the description "Link each group to a client so its messages become tickets".
   - **Replies to place** comes first, and only when there are any. Each card shows:
     - the group name, the sender, the time and the text (clamped to 3 lines);
     - a select of the option tickets (`#number title`), with a "Place" button and a "Not a reply" button.
     - After an action, reload. On a 409, show the error and reload.
   - **Groups**, a list with:
     - the name;
     - "Group" or "Private chat";
     - last message time;
     - a project select (the same project list the imports page loads), whose "Not linked" option sends null;
     - not-linked groups shown first, with the hint "Messages are ignored until you link this group".
     - Changing the select PATCHes right away and shows "Saved" or the error.
   - **Senders**, per group, expandable: lists the senders with a "Staff" checkbox (PATCH senders). Senders from the Team page show a checked, disabled box with the hint "From Team".
   - Loading, empty ("No groups yet. Add the bot number to a WhatsApp group.") and error states.
   - At 390px: cards stack and selects take the full width.
3. Add `/channels/whatsapp` to `scripts/smoke-pages.mjs`.

Follow the patterns of `src/app/(dashboard)/imports/[id]/page.tsx` and `knowledge/drafts/page.tsx`: header, `errorText`, buttons, helplus tokens only.

- [ ] **Step 1: Write the failing test for `botLabel`**

```ts
import { describe, it, expect } from "vitest";
import { botLabel } from "@/app/(dashboard)/channels/bot-label";

describe("botLabel", () => {
  it("shows a stale worker as red", () => {
    expect(botLabel({ status: "connected", stale: true, phone: "60111", error: "" })).toEqual({ text: "Worker not running", tone: "danger" });
  });
  it("shows the bot number when connected", () => {
    expect(botLabel({ status: "connected", stale: false, phone: "60111", error: "" })).toEqual({ text: "Connected as +60111", tone: "success" });
  });
  it("adds the error to a disconnect", () => {
    expect(botLabel({ status: "disconnected", stale: false, phone: "", error: "WhatsApp disconnected." }).text).toBe("Disconnected. WhatsApp disconnected.");
  });
});
```

- [ ] **Step 2: Run it, check that it fails, then write `bot-label.ts`**

Run: `npx vitest run tests/unit/bot-card.test.ts`
Expected: FAIL, then PASS after writing:

```ts
export type Tone = "success" | "danger" | "warning" | "muted";
export function botLabel(s: { status: string; stale: boolean; phone: string; error: string }): { text: string; tone: Tone } {
  if (s.status === "connected") return s.stale ? { text: "Worker not running", tone: "danger" } : { text: `Connected as +${s.phone}`, tone: "success" };
  if (s.status === "qr") return { text: "Scan the QR code", tone: "warning" };
  if (s.status === "starting") return { text: "Starting…", tone: "muted" };
  if (s.status === "stopping") return { text: "Stopping…", tone: "muted" };
  if (s.status === "disconnected") return { text: s.error ? `Disconnected. ${s.error}` : "Disconnected", tone: "danger" };
  return { text: "Not connected", tone: "muted" };
}
```

Map `muted` to `text-helplus-text-light` in the card.

- [ ] **Step 3: Build the card and the page** as described.

- [ ] **Step 4: Run the checks**

Run: `npx vitest run && npx tsc --noEmit && npm run lint && npm run smoke`
Expected:
- all pass, with 0 lint errors;
- smoke has no runtime errors on `/channels` and `/channels/whatsapp`.

Puppeteer check at 1280 and 390 widths:
1. Insert, with psql, a not-linked chat, a linked chat and one `pick` row with an open ticket.
2. Load `/channels/whatsapp`, link the chat, place the pick.
3. Save screenshots to `.superpowers/sdd/shots-3c/`.
4. Delete the test rows afterwards.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/channels" scripts/smoke-pages.mjs tests/unit/bot-card.test.ts && git commit -m "whatsapp bot card and groups page" -- "src/app/(dashboard)/channels" scripts/smoke-pages.mjs tests/unit/bot-card.test.ts
```

---

### Task 8: Docs and the full check

**Files:**
- Modify: `CHANGELOG.md`, `.env.example` (only if a new variable was added; none is planned), `docker-compose.yml` and `helm/helplus/templates/deployment.yaml` (the `.wwebjs_auth` volume must be mounted on the **worker** container, not only the app; check both)

- [ ] **Step 1: Add a 3C section to the CHANGELOG**, following the 3B section's style.

  Added:
  - The WhatsApp bot runs in the worker and reads linked groups and private chats. Client messages become tickets after 2 quiet minutes. A staff reply that quotes a client answers that ticket. Other replies go to the only recent open ticket, or wait in Sources > WhatsApp groups > Replies to place.

  Changed:
  - The old WhatsApp connection is removed. It ran inside the web server and auto-replied with AI. Help+ no longer sends anything on WhatsApp.

  Upgrade notes:
  - Run the worker (`npm run worker`) all the time. It runs the bot.
  - Mount `.wwebjs_auth` on the worker.
  - A number that was linked before keeps its session.
  - Link each group to a client in Sources > WhatsApp groups. Messages in groups that aren't linked are ignored.
  - Staff are recognised by phone numbers in Settings > Team, or by ticking Staff on a sender.

  Known limits:
  - The bot uses an unofficial WhatsApp client, so the number can be banned. Use a separate number, never make it the only group admin, and tell the group it's there.
  - New bot tickets show when the ticket list reloads (no live push from the worker).
  - Times follow the server clock.
  - Messages sent while the bot is disconnected are not fetched later. Use a chat export to fill the gap.
  - Voice notes, videos and documents become a note in the text. Only images are kept, and they're IC-checked.

  Before writing the "not fetched later" line, check whether whatsapp-web.js delivers missed messages on reconnect. If it does, say that instead.

  Also check the ticket list reload behaviour mentioned in "Decisions" and describe it accurately.

- [ ] **Step 2: Fix the compose and helm volume** if the worker doesn't mount `.wwebjs_auth` (and `storage/`, for bot images).

- [ ] **Step 3: Full check**

Run, in order:
1. `npx tsc --noEmit`
2. `npx vitest run`
3. `npm run test:integration`
4. `npm run lint`
5. `npm run worker -- --once`
6. `npm run smoke`
7. Stop the dev server, then `npx next build`, then restart it.

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md docker-compose.yml helm/helplus/templates/deployment.yaml && git commit -m "changelog and worker volumes for the whatsapp bot" -- CHANGELOG.md docker-compose.yml helm/helplus/templates/deployment.yaml
```

Drop any file from the list that didn't change.

---

## Not in this stage

- AI picking the ticket for unquoted staff replies (stage 4).
- Fetching messages missed while disconnected (unless whatsapp-web.js already does it, see Task 8).
- Live push of new bot tickets to open screens.
- More than one bot number per company.
