# Help+ design

Date: 2026-10-04
Status: draft, waiting for review

## Problem

Support issues come in through WhatsApp: staff's own chats, a group where
client admins post, and an older system that isn't automated. Issues get lost
in long threads. The same questions come back and staff scroll old chats to
find how they were answered. Nobody can see what's open, what's closed, or who
is handling what.

## Goal

- Every issue becomes a ticket with a status and an owner.
- The AI answers first where a past answer exists, and stays quiet where it doesn't.
- Clients can look up answers and raise issues themselves.
- Managers get a dashboard and an Excel report for any date range.
- Built so it can be sold as SaaS later without a rewrite.

## Decisions

| Topic | Decision |
|---|---|
| Base | Keep the existing backend (Prisma, auth, API, channels, tests). Rebuild the screens. |
| Name | Code name `helplus`, display name "Help+". LICENSE keeps the original MIT notice. |
| Phase 1 replies | AI suggests, staff send in WhatsApp. Clients also use a web help centre. |
| Later | Official WhatsApp number with direct AI replies; AI bot in groups. |
| Intake | Staff quick add, silent read-only WhatsApp bot, WhatsApp chat export, old system CSV/Excel. |
| SaaS | Multi-company from day one. We are company #1. |
| Client/project | Same thing, label chosen per company ("Clients" or "Projects"). |
| Library | Separate per client/project. Copy an article to other projects when needed. |
| AI provider | Pluggable. OpenAI, DeepSeek, any OpenAI-compatible server (Ollama, LM Studio). |
| Look | Indigo `#3B3FA6`, warm greys, IBM Plex Sans/Mono, Lucide icons, no emoji, works on phones. |
| Hosting | Local first (ServBay Postgres). Containers for production. Server not chosen yet. |

Approved prototype: `.superpowers/brainstorm/803-1791080862/content/prototype-v3b.html`
(local only, not in git).

## Structure

```
Company (tenant)
 └─ Client / Project
     ├─ People (client users)
     ├─ Tickets
     ├─ Library (articles + saved replies)
     ├─ Sources (e.g. its WhatsApp group)
     └─ SLA rules (optional override of company rules)
```

### Roles

| Role | Sees |
|---|---|
| Owner | Company setup, billing (later) |
| Admin | Everything in the company |
| Staff | Tickets and Library of the projects they're assigned to |
| Client | Own project's Library and own tickets |

### Menus

- Admin: Dashboard, Tickets, Clients/Projects, Library, Sources, Settings
- Staff: My tickets, Unassigned, Library
- Client: Help, My tickets, New issue
- Phone: bottom tabs, "More" when there are more than five

Old menus move into Settings: General & AI, Closing tickets, Privacy & IC,
Team & departments, Business hours, SLA rules, Automation, Integrations
(webhooks), Users & roles, Audit log, Developer/API. Conversations merge into
the ticket view. Canned responses become Library > Saved replies.

## 1. Foundation

- New `Company` model. Every company-owned record gets `companyId`.
  Queries go through one scoped data layer so a page can't forget the filter.
- `Settings` becomes per company (today it's a single row with id `default`).
- Secrets in the database (AI keys, SMTP and IMAP passwords, Twilio token) are
  encrypted at rest. Today they're plain text.
- Users: staff/admin/owner and client users, with roles above. Staff can be
  limited to certain projects.
- AI layer exposes `suggestReply`, `extractQA`, `readScreenshot`, `embed`.
  Provider, model and key are set per company. The embedding provider can differ
  from the chat provider. IC masking runs inside this layer before any call.
- New app shell matching the prototype. The 13 old pages that read paginated
  API responses wrong get fixed as they move into the new shell.

## 2. Tickets

Fields: per-company number, client/project, reporter, source, category,
priority, status, assignee, messages, attachments, first reply time, closed
time, reopen count, AI match %, SLA due times.

Message types: client, staff, AI, internal note (staff only).

Statuses:

```
New → AI Suggested → Answered → Closed
                         ↓ client not happy
                     Reopened → Staff working → Closed
```

- Auto-close: a job closes Answered tickets after N days without a client reply.
  Per company: N days, or staff close only. Client gets a warning a day before.
- Reopened tickets go back to the same staff member, who gets an email.
- Quick add: staff paste text and drop screenshots, AI pre-fills title, category
  and project, staff confirm.
- List filters: status, project, staff, source, SLA state, search. Cards on phones.

### SLA

- Rules per company, with optional overrides by client/project, priority,
  category and source. Example: High priority, first reply 2h, solve 1 day.
- Two clocks: first reply and resolution. Business hours and holidays of the
  company only. Paused while the ticket is Answered (waiting on the client).
- Near breach: orange in the list. Breached: red, email to the assignee.
- Extends the existing `SLARule` model, which today only filters by channel
  and priority and isn't per company.

### Emails

New ticket, reopen, SLA warning, breach, staff reply, closed. Link only.
Never screenshots or IC data.

## 3. Intake

All sources go through the same pipeline:

```
source → hide IC → group into issues (AI) → tickets + Library drafts
```

### IC masking

- Text: Malaysian IC with or without dashes or spaces
  (`900101-14-5678`, `900101145678`) becomes `[IC HIDDEN]`. Lean towards
  over-masking. Companies can add extra patterns later.
- Images: Tesseract OCR on our server finds IC numbers and covers them.
- Low OCR confidence (blurry, rotated, cropped): image marked "needs check" and
  kept away from the AI and the Library until staff confirm or mask it by hand.
- Originals: encrypted, staff only, every view written to the audit log,
  deleted N days after the ticket closes (per company setting, default 90).

### WhatsApp chat export

- Upload `.zip` (with media) or `.txt`, pick the client/project.
- Parser handles Android and iPhone formats, different date formats, 12/24h time.
- Duplicate messages from overlapping exports are skipped.
- AI groups messages: client question plus following staff replies becomes one
  ticket (closed if answered). Each Q&A pair goes to Library > Waiting approval.
- Staff are recognised by names or numbers listed in Settings > Team.

### Old system import

- CSV or Excel upload, map columns once, mapping saved for next time.
- Preview 20 rows before import.
- Rows become closed tickets with their answers. Re-imports skip rows already
  seen (by old ID).
- Bad rows don't stop the import. They're listed with a reason and can be
  downloaded.

### Silent WhatsApp bot

- Runs in the `worker` process. Each company links its own bot number by QR.
- Read-only: the sending code is removed, not just disabled.
- Each group is linked to a client/project.
- New client message: wait about 2 minutes for follow-ups, then create a ticket.
- Staff reply quoting a client message: attach to that ticket, mark Answered.
- Staff reply without a quote: AI picks the most likely open ticket, or asks
  staff to choose when unsure.
- Disconnect: email the admin, red status on Sources. Exports still work.
- Risk accepted: unofficial client, the bot number can be banned. Use a
  dedicated number, never the only group admin, tell the group it's there.

### File storage

Local disk in development. S3-compatible storage (MinIO) in production.

## 4. AI

### Similar tickets

- Search only inside the ticket's client/project.
- Hybrid: embeddings from the AI provider plus `pg_trgm` keyword matching.
- Local ServBay Postgres has `pg_trgm` but not `pgvector`, so embeddings are
  stored as float arrays and compared in the app. Fine for thousands of tickets
  per project. Can move to `pgvector` in the production database later behind
  the same function.

### Suggested replies

1. Find top 3 to 5 closed tickets and approved articles in the same project.
2. AI writes a reply using only those and names the ones it used.
3. Below the company's match threshold (default 75%), no suggestion at all.
   Ticket goes to Staff working.
4. Staff: copy and mark answered, edit, or "not right".

### Learning

- Edited suggestions: the final staff version is what's stored and learned.
- "Not right" lowers that match next time.
- Closed tickets with a staff answer become searchable right away.
- Library drafts from imports and chats are used only after approval.
- A reopened ticket marks the AI answer that failed.

### Screenshots

AI reads the masked image only. "Needs check" images are never sent.

### Limits

- Monthly AI budget per company. When used up, suggestions pause and staff see a notice.
- Usage logged per company and project.

### Language

Reply in the client's language: Malay, English or mixed.

## 5. Client side

- Help centre per company: `/help/<company>`. Custom domains later.
- Login required. Clients are invited by email and linked to a project.
  Login by email link or password.
- UI in Malay and English. Turkish strings are removed.
- Flow: search, then a short form (title, details, optional screenshot), then an
  instant AI answer from the project's Library and past tickets.
  "This solved it" creates no ticket and counts towards Solved by AI.
  "Open a ticket" creates one, emails staff, emails the client the number.
- My tickets: status, latest reply, add details or screenshots.
- On Answered: "Did this solve your problem?" Yes closes, No reopens with an
  optional reason.
- Rate limits on the form even with login.

## 6. Reports

- Filters: date range (presets and custom), client/project, staff.
- Numbers:
  - New: created in range
  - Open: not closed at the end of the range
  - Closed: closed in range
  - Reopened: reopened in range
  - Solved by AI: client confirmed with no staff reply
- Charts: new vs closed per day, open by age (0-2, 3-7, 8-30, 30+ days),
  by staff, top repeated issues, SLA met %.
- Excel export, 8 sheets: Summary, Trend, By Staff, By Project, By Category,
  By Client person, Aging, Ticket List. CSV too. No IC numbers in any export.

## Errors

| Problem | Behaviour |
|---|---|
| AI provider down or budget used | No suggestion, ticket continues normally, admin notice |
| OCR can't read a screenshot | Marked needs check, held back from AI and Library |
| Bot disconnects | Email admin, red status, exports still work |
| Import has bad rows | Good rows import, bad rows listed with reason |
| Email server down | Queue and retry, failures shown in Settings |

## Testing

- IC masking: large sample set of text and screenshots. Highest priority.
- WhatsApp parser: Android and iPhone exports, English and Malay date formats.
- Isolation: staff and client attempts to read another company's or project's
  data must fail.
- SLA clock: business hours, holidays, pauses.
- End-to-end: client reports, AI answers, ticket opens, staff answers, client
  says not solved, reopen, close.
- Existing 299 tests keep passing.

## Running it

- Development: ServBay Postgres, `npm run dev`, worker as a second process.
- Team testing: Cloudflare Tunnel or ngrok, after changing the demo password.
- Production containers: `caddy` (HTTPS), `app`, `worker` (bot, OCR, imports,
  auto-close, email), `db` (private, no public port), `minio`. Secrets in
  `.env`, automatic backups.
- Fix in the current compose file: weak database password, port 5432 exposed,
  no HTTPS.

## Build order

Each stage gets its own plan, build and test, and is usable on its own.

1. Foundation: companies, roles, encrypted secrets, AI layer, new shell, broken page fixes
2. Tickets core: statuses, inbox, quick add, clients/projects, auto-close, SLA
3. Intake: IC masking, WhatsApp export, old system import, silent bot
4. AI: similar search, suggested replies, Library approval queue
5. Client side: help centre, form, "did this solve it", emails
6. Reports: dashboard, Excel export

## Known issues in the base code

- List pages call `setX(data)` but the APIs return `{ data, pagination }`.
- Hydration warnings from browser extensions: add `suppressHydrationWarning` to `<body>`.
- Seed script doesn't load `.env`.
- Unused code: `searchKnowledgeBase`, `evaluateRules`, `sendWhatsAppMessage`.
- AI keeps replying on escalated conversations.

## Not in phase 1

- Official WhatsApp number with direct AI replies
- AI replies inside WhatsApp groups
- SaaS sign-up, billing, custom domains
- Monthly PDF report

## Open items

- Which server for production.
- Production domain name.
- PDPA review of the IC handling by whoever handles compliance.
