# Stage 1A: Foundation (no tenancy yet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken list pages, encrypt stored secrets, hide IC numbers before any AI call, make the AI provider pluggable (OpenAI, DeepSeek, Ollama, any OpenAI-compatible server), and replace the old look with the approved Indigo shell that works on phones.

**Architecture:** Settings are read and written through one module (`src/lib/settings.ts`) that decrypts/encrypts secrets, so stage 1B can make it per-company in one place. All AI calls go through `src/lib/ai/provider.ts`, which masks IC numbers before anything leaves the server. The new shell is a sidebar on desktop, bottom tabs on phones, and a tab bar for grouped pages, driven by one nav definition file.

**Tech Stack:** Next.js 16 (app router), React 19, Prisma 7 + PostgreSQL, Tailwind 4, `openai` SDK 6 (also used for DeepSeek/Ollama via `baseURL`), Vitest, Puppeteer (smoke test only), lucide-react.

Spec: `docs/specs/2026-10-04-helplus-design.md` (section 1, minus companies/roles which are stage 1B).

## Global Constraints

- Code name `helplus`, display name "Help+". No "owly" anywhere except `LICENSE`.
- Comments: only when needed, short and plain, written like a person would. No "This function...", no emoji.
- Commit messages: short, lowercase, plain (e.g. `encrypt stored secrets`). No Co-Authored-By trailer.
- Commit locally only. Never push. `origin` still points at the upstream repo.
- Colours: indigo `#3B3FA6`, warm greys, all text pairs at least 4.5:1 contrast.
- Fonts: IBM Plex Sans and IBM Plex Mono. Icons: lucide-react. No emoji in UI.
- Nothing reaches an AI provider without going through `maskIC`.
- Run the dev server against ServBay Postgres: database `helpplus`, user `helpplus`.
- Before every commit: `npx vitest run` passes and `npx tsc --noEmit` is clean.

---

## File map

| File | Status | Job |
|---|---|---|
| `src/lib/api-client.ts` | new | unwrap `{ data, pagination }` list responses |
| `scripts/smoke-pages.mjs` | new | open every dashboard page in Chrome, fail on runtime errors |
| `src/lib/secrets.ts` | new | AES-256-GCM encrypt/decrypt for stored secrets |
| `src/lib/settings.ts` | new | the only place that reads/writes the `Settings` row |
| `scripts/encrypt-secrets.ts` | new | one-off: encrypt secrets saved before this change |
| `src/lib/privacy/ic-mask.ts` | new | hide Malaysian IC numbers in text |
| `src/lib/ai/provider.ts` | new | OpenAI-compatible client, chat + embeddings, masks input |
| `src/lib/ai/config.ts` | new | build provider configs from settings |
| `prisma/migrations/20261004000000_ai_provider_fields/migration.sql` | new | new AI settings columns |
| `src/components/layout/nav-items.ts` | new | every nav list + active-route helpers |
| `src/components/layout/bottom-tabs.tsx` | new | phone tab bar |
| `src/components/layout/section-tabs.tsx` | new | tab bar for Dashboard / Library / Settings groups |
| `src/app/(dashboard)/more/page.tsx` | new | phone "More" page |
| `src/components/layout/sidebar.tsx` | rewrite | desktop sidebar |
| `src/app/(dashboard)/layout.tsx` | modify | mount sidebar, tabs, bottom tabs |
| `src/app/globals.css` | modify | Indigo tokens, link token, fonts |
| `src/app/layout.tsx` | modify | Plex fonts, hydration fix, metadata |
| 14 dashboard pages + onboarding checklist | modify | use `unwrapList` |
| `src/lib/ai/engine.ts`, `semantic-search.ts`, `types.ts` | modify | use provider + settings module |
| `src/app/api/settings/route.ts`, `health/route.ts`, `knowledge/test/route.ts` | modify | use settings module / provider |
| `src/lib/ai/tools.ts`, `src/lib/channels/{email,phone,sms,telegram}.ts`, `src/lib/twilio-verify.ts` | modify | use settings module |
| `src/lib/security.ts`, `src/lib/validations.ts` | modify | new secret + AI fields |
| `src/app/(dashboard)/settings/page.tsx` | modify | provider-agnostic AI section |
| `prisma/schema.prisma`, `prisma/seed.ts`, `package.json`, `.env.example` | modify | fields, env loading, scripts |

Not in this stage: companies, roles, the new ticket screens. Old pages keep their own inner layouts, so some (Conversations, Knowledge) stay cramped on phones until they're rebuilt in later stages.

---

### Task 1: Fix list pages and small dev annoyances

Most list APIs return `{ data, pagination }` but 14 pages treat the whole object as the array, which crashes with `x.map is not a function`.

**Files:**
- Create: `src/lib/api-client.ts`, `tests/unit/api-client.test.ts`, `scripts/smoke-pages.mjs`
- Modify: the pages listed in Step 6, `src/components/ui/onboarding-checklist.tsx`, `src/app/layout.tsx`, `prisma/seed.ts`, `package.json`

**Interfaces:**
- Produces: `unwrapList<T>(json: unknown): T[]`, `listMeta(json: unknown): ListMeta | null`, `interface ListMeta { page: number; limit: number; total: number; totalPages: number }`

- [ ] **Step 1: Write the smoke script (it should fail right now)**

Create `scripts/smoke-pages.mjs`:

```js
// opens every dashboard page in chrome and fails on runtime errors.
// needs the dev server running: npm run dev
import puppeteer from "puppeteer";

const BASE = process.env.SMOKE_URL || "http://localhost:3000";
const USER = process.env.SMOKE_USER || "admin";
const PASS = process.env.SMOKE_PASS || "admin123";

const PAGES = [
  "/", "/conversations", "/customers", "/tickets", "/knowledge",
  "/knowledge/test", "/canned-responses", "/automation", "/business-hours",
  "/team", "/sla", "/channels", "/webhooks", "/analytics", "/activity",
  "/admin", "/api-docs", "/settings",
  ...(process.env.SMOKE_EXTRA ? process.env.SMOKE_EXTRA.split(",") : []),
];

const browser = await puppeteer.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [];

page.on("pageerror", (e) => errors.push(`${page.url()} -> ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && /TypeError|is not a function|Cannot read/.test(m.text())) {
    errors.push(`${page.url()} -> ${m.text()}`);
  }
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
const status = await page.evaluate(
  async (u, p) => {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", username: u, password: p }),
    });
    return res.status;
  },
  USER,
  PASS
);
if (status !== 200) {
  console.error(`login failed (${status})`);
  process.exit(1);
}

for (const path of PAGES) {
  await page.goto(BASE + path, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 500));
  console.log("visited", path);
}

await browser.close();

if (errors.length) {
  console.error("\nruntime errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("no runtime errors");
```

Add to `package.json` scripts (after `"format:check"`):

```json
    "smoke": "node scripts/smoke-pages.mjs",
```

- [ ] **Step 2: Run it and watch it fail**

Start the dev server in another terminal (`npm run dev`), then:

Run: `npm run smoke`
Expected: exits 1, lists errors such as `/automation -> rules.map is not a function`.

- [ ] **Step 3: Write the failing unit test**

Create `tests/unit/api-client.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { unwrapList, listMeta } from "@/lib/api-client";

describe("unwrapList", () => {
  it("returns data from a paginated response", () => {
    const json = { data: [{ id: 1 }, { id: 2 }], pagination: { page: 1, limit: 20, total: 2, totalPages: 1 } };
    expect(unwrapList(json)).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("passes a plain array through", () => {
    expect(unwrapList([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("returns an empty array for anything else", () => {
    expect(unwrapList(null)).toEqual([]);
    expect(unwrapList({ error: "nope" })).toEqual([]);
    expect(unwrapList("text")).toEqual([]);
  });
});

describe("listMeta", () => {
  it("returns pagination when present", () => {
    const meta = { page: 2, limit: 10, total: 25, totalPages: 3 };
    expect(listMeta({ data: [], pagination: meta })).toEqual(meta);
  });

  it("returns null without pagination", () => {
    expect(listMeta([1, 2])).toBeNull();
    expect(listMeta(undefined)).toBeNull();
  });
});
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `npx vitest run tests/unit/api-client.test.ts`
Expected: FAIL, cannot resolve `@/lib/api-client`.

- [ ] **Step 5: Write the helper**

Create `src/lib/api-client.ts`:

```ts
export interface ListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// list endpoints return { data, pagination }; a few older ones return a bare array
export function unwrapList<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (json && typeof json === "object" && Array.isArray((json as { data?: unknown }).data)) {
    return (json as { data: T[] }).data;
  }
  return [];
}

export function listMeta(json: unknown): ListMeta | null {
  if (json && typeof json === "object" && "pagination" in json) {
    return (json as { pagination: ListMeta }).pagination;
  }
  return null;
}
```

Run: `npx vitest run tests/unit/api-client.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Use it in every broken page**

In each file below, add `import { unwrapList } from "@/lib/api-client";` next to the other `@/lib` imports, then make the replacement. Each "old" string appears once in its file.

| File (under `src/app/(dashboard)/`) | Old | New |
|---|---|---|
| `admin/page.tsx` | `setUsers(data);` | `setUsers(unwrapList(data));` |
| `admin/page.tsx` | `setApiKeys(data);` | `setApiKeys(unwrapList(data));` |
| `automation/page.tsx` | `setRules(data);` | `setRules(unwrapList(data));` |
| `canned-responses/page.tsx` | `setResponses(data);` | `setResponses(unwrapList(data));` |
| `conversations/page.tsx` | `setConversations(data);` | `setConversations(unwrapList(data));` |
| `customers/page.tsx` | `setCustomers(data.customers);` | `setCustomers(unwrapList(data));` |
| `knowledge/page.tsx` | `setCategories(data);` | `setCategories(unwrapList(data));` |
| `knowledge/page.tsx` | `setEntries(data);` | `setEntries(unwrapList(data));` |
| `sla/page.tsx` | `setRules(data);` | `setRules(unwrapList(data));` |
| `team/page.tsx` | `setDepartments(data);` | `setDepartments(unwrapList(data));` |
| `team/page.tsx` | `setMembers(data);` | `setMembers(unwrapList(data));` |
| `tickets/page.tsx` | `setTickets(data);` | `setTickets(unwrapList(data));` |
| `tickets/page.tsx` | `setDepartments(data);` | `setDepartments(unwrapList(data));` |
| `webhooks/page.tsx` | `setWebhooks(data);` | `setWebhooks(unwrapList(data));` |

`knowledge/test/page.tsx` (add the same import):

```ts
      const categories = categoriesRes.ok ? await categoriesRes.json() : [];
      const entries = entriesRes.ok ? await entriesRes.json() : [];
```
becomes
```ts
      const categories = unwrapList(categoriesRes.ok ? await categoriesRes.json() : []);
      const entries = unwrapList<{ isActive: boolean; updatedAt: string }>(
        entriesRes.ok ? await entriesRes.json() : []
      );
```

`activity/page.tsx` — import both helpers: `import { unwrapList, listMeta } from "@/lib/api-client";`, then

```ts
        const json = await res.json();
        setData(json);
```
becomes
```ts
        const json = await res.json();
        const meta = listMeta(json);
        setData({
          activities: unwrapList(json),
          total: meta?.total ?? 0,
          page: meta?.page ?? 1,
          limit: meta?.limit ?? 20,
          totalPages: meta?.totalPages ?? 1,
        });
```

`src/components/ui/onboarding-checklist.tsx` (add the import):

```ts
      const entries = entriesRes.ok ? await entriesRes.json() : [];
```
becomes
```ts
      const entries = unwrapList(entriesRes.ok ? await entriesRes.json() : []);
```
and
```ts
      const team = teamRes.ok ? await teamRes.json() : [];
```
becomes
```ts
      const team = unwrapList(teamRes.ok ? await teamRes.json() : []);
```

- [ ] **Step 7: Silence browser-extension hydration noise and fix the seed**

`src/app/layout.tsx`: change `<body className="h-full">` to `<body className="h-full" suppressHydrationWarning>`.

`prisma/seed.ts`: insert as the first statement after the imports (before `const connectionString`):

```ts
// pick up .env when run by hand; in docker the vars are already set
try {
  (process as { loadEnvFile?: () => void }).loadEnvFile?.();
} catch {
  // no .env file, that's fine
}
```

- [ ] **Step 8: Check everything**

Run: `npx tsc --noEmit` — Expected: no output.
Run: `npx vitest run` — Expected: all pass (299 + 5 new).
Run: `npm run smoke` (dev server running) — Expected: `no runtime errors`.
Run: `npm run db:seed` — Expected: `Seed data created successfully!` (no auth error).

- [ ] **Step 9: Commit**

```bash
git add src/lib/api-client.ts tests/unit/api-client.test.ts scripts/smoke-pages.mjs package.json "src/app/(dashboard)" src/components/ui/onboarding-checklist.tsx src/app/layout.tsx prisma/seed.ts
git commit -m "fix list pages reading paginated api"
```

---

### Task 2: Encrypt stored secrets

**Files:**
- Create: `src/lib/secrets.ts`, `tests/unit/secrets.test.ts`
- Modify: `tests/setup.ts`, `.env.example`, `.env` (local only, not committed)

**Interfaces:**
- Produces: `encryptSecret(plain: string): string`, `decryptSecret(value: string): string`, `isEncrypted(value: string): boolean`. Encrypted values look like `enc:v1:<base64>`. Key comes from `HELPLUS_SECRET_KEY` (64 hex chars).

- [ ] **Step 1: Give tests a key**

In `tests/setup.ts`, below `process.env.NODE_ENV = "test";` add:

```ts
process.env.HELPLUS_SECRET_KEY = "a1".repeat(32);
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/secrets.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted } from "@/lib/secrets";

const KEY = "a1".repeat(32);

afterEach(() => {
  process.env.HELPLUS_SECRET_KEY = KEY;
});

describe("secrets", () => {
  it("round-trips a value", () => {
    const enc = encryptSecret("sk-live-abc123");
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain("sk-live-abc123");
    expect(decryptSecret(enc)).toBe("sk-live-abc123");
  });

  it("uses a fresh iv every time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("leaves empty strings alone", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret("")).toBe("");
  });

  it("does not encrypt twice", () => {
    const enc = encryptSecret("x");
    expect(encryptSecret(enc)).toBe(enc);
  });

  it("returns old plain-text values as they are", () => {
    expect(decryptSecret("sk-old-plain")).toBe("sk-old-plain");
  });

  it("throws when the value was tampered with", () => {
    const enc = encryptSecret("secret");
    const raw = Buffer.from(enc.slice("enc:v1:".length), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret("enc:v1:" + raw.toString("base64"))).toThrow();
  });

  it("throws without a valid key", () => {
    process.env.HELPLUS_SECRET_KEY = "short";
    expect(() => encryptSecret("x")).toThrow(/HELPLUS_SECRET_KEY/);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run tests/unit/secrets.test.ts`
Expected: FAIL, cannot resolve `@/lib/secrets`.

- [ ] **Step 4: Write the module**

Create `src/lib/secrets.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const PREFIX = "enc:v1:";

function key(): Buffer {
  const hex = process.env.HELPLUS_SECRET_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("HELPLUS_SECRET_KEY must be 64 hex characters (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plain: string): string {
  if (!plain || isEncrypted(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, body]).toString("base64");
}

// values saved before encryption existed come back unchanged
export function decryptSecret(value: string): string {
  if (!value || !isEncrypted(value)) return value;
  const raw = Buffer.from(value.slice(PREFIX.length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/unit/secrets.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Document and set the key**

Append to `.env.example`:

```
# [REQUIRED] Key for encrypting saved passwords and API keys (64 hex chars).
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Keep it safe. Losing it means re-entering every saved key and password.
HELPLUS_SECRET_KEY=""
```

Generate a key and add it to your local `.env` (not committed):

Run: `node -e "console.log('HELPLUS_SECRET_KEY=\"' + require('crypto').randomBytes(32).toString('hex') + '\"')" >> .env`

- [ ] **Step 7: Commit**

```bash
git add src/lib/secrets.ts tests/unit/secrets.test.ts tests/setup.ts .env.example
git commit -m "add secret encryption helper"
```

---

### Task 3: Read and write settings through one module

Today 13 places read the `Settings` row directly. Route them through `getSettings()` / `saveSettings()` so secrets are decrypted on read and encrypted on write. This also fixes a real bug: the settings page posts `"***"` back for untouched secrets and the API saves it, wiping the real key.

**Files:**
- Create: `src/lib/settings.ts`, `tests/unit/settings-store.test.ts`, `scripts/encrypt-secrets.ts`
- Modify: `src/lib/security.ts`, `tests/helpers/fixtures.ts`, `src/app/api/settings/route.ts`, `src/app/api/health/route.ts`, `src/app/api/knowledge/test/route.ts`, `src/lib/ai/engine.ts`, `src/lib/ai/semantic-search.ts`, `src/lib/ai/tools.ts`, `src/lib/channels/email.ts`, `src/lib/channels/phone.ts`, `src/lib/channels/sms.ts`, `src/lib/channels/telegram.ts`, `src/lib/twilio-verify.ts`, `tests/unit/ai-engine.test.ts`, `tests/unit/ai-tools.test.ts`, `tests/api/health.test.ts`

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret` (Task 2)
- Produces: `getSettings(): Promise<Settings>`, `saveSettings(input: Prisma.SettingsUpdateInput): Promise<Settings>`, `prepareSettingsUpdate(input: Record<string, unknown>): Record<string, unknown>`. `Settings` and `Prisma` come from `@/generated/prisma/client`.

- [ ] **Step 1: Treat the Telegram token as a secret**

`src/lib/security.ts`, in `SECRET_FIELDS`, add `"telegramBotToken",` after `"whatsappApiKey",`.

`tests/helpers/fixtures.ts`, in `settings`, add after `whatsappPhone: "+1234567890",`:

```ts
    telegramBotToken: "tg-token-12345",
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/settings-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { fixtures } from "../helpers/fixtures";
import { encryptSecret, isEncrypted } from "@/lib/secrets";
import { getSettings, saveSettings, prepareSettingsUpdate } from "@/lib/settings";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

beforeEach(() => {
  mockPrisma.settings.findUnique.mockReset();
  mockPrisma.settings.create.mockReset();
  mockPrisma.settings.upsert.mockReset();
});

describe("getSettings", () => {
  it("decrypts secrets", async () => {
    mockPrisma.settings.findUnique.mockResolvedValue({
      ...fixtures.settings,
      aiApiKey: encryptSecret("sk-real"),
    });
    const s = await getSettings();
    expect(s.aiApiKey).toBe("sk-real");
    expect(s.businessName).toBe("Test Business");
  });

  it("creates the default row when missing", async () => {
    mockPrisma.settings.findUnique.mockResolvedValue(null);
    mockPrisma.settings.create.mockResolvedValue({ ...fixtures.settings });
    await getSettings();
    expect(mockPrisma.settings.create).toHaveBeenCalledWith({ data: { id: "default" } });
  });
});

describe("prepareSettingsUpdate", () => {
  it("drops masked secrets so the stored value survives", () => {
    const out = prepareSettingsUpdate({ aiApiKey: "***", businessName: "X" });
    expect(out).toEqual({ businessName: "X" });
  });

  it("encrypts new secrets and leaves other fields alone", () => {
    const out = prepareSettingsUpdate({ smtpPass: "hunter2", smtpHost: "mail.x" });
    expect(isEncrypted(out.smtpPass as string)).toBe(true);
    expect(out.smtpHost).toBe("mail.x");
  });

  it("keeps an empty secret empty so it can be cleared", () => {
    expect(prepareSettingsUpdate({ aiApiKey: "" })).toEqual({ aiApiKey: "" });
  });
});

describe("saveSettings", () => {
  it("writes encrypted values and returns decrypted ones", async () => {
    mockPrisma.settings.upsert.mockImplementation(async ({ update }) => ({
      ...fixtures.settings,
      ...update,
    }));
    const s = await saveSettings({ aiApiKey: "sk-new" });
    const written = mockPrisma.settings.upsert.mock.calls[0][0].update.aiApiKey;
    expect(isEncrypted(written)).toBe(true);
    expect(s.aiApiKey).toBe("sk-new");
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run tests/unit/settings-store.test.ts`
Expected: FAIL, cannot resolve `@/lib/settings`.

- [ ] **Step 4: Write the module**

Create `src/lib/settings.ts`:

```ts
import { prisma } from "@/lib/prisma";
import type { Prisma, Settings } from "@/generated/prisma/client";
import { SECRET_FIELDS } from "@/lib/security";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

const MASK = "***";

function decryptRow(row: Settings): Settings {
  const out = { ...row };
  for (const field of SECRET_FIELDS) {
    out[field] = decryptSecret(out[field] ?? "");
  }
  return out;
}

export async function getSettings(): Promise<Settings> {
  const row =
    (await prisma.settings.findUnique({ where: { id: "default" } })) ??
    (await prisma.settings.create({ data: { id: "default" } }));
  return decryptRow(row);
}

// the settings page posts "***" back for secrets it never saw, so skip those
export function prepareSettingsUpdate(input: Record<string, unknown>): Record<string, unknown> {
  const out = { ...input };
  for (const field of SECRET_FIELDS) {
    const value = out[field];
    if (value === MASK) delete out[field];
    else if (typeof value === "string") out[field] = encryptSecret(value);
  }
  return out;
}

export async function saveSettings(input: Prisma.SettingsUpdateInput): Promise<Settings> {
  const data = prepareSettingsUpdate(input as Record<string, unknown>) as Prisma.SettingsUpdateInput;
  const row = await prisma.settings.upsert({
    where: { id: "default" },
    update: data,
    create: { id: "default", ...(data as Prisma.SettingsCreateInput) },
  });
  return decryptRow(row);
}
```

Run: `npx vitest run tests/unit/settings-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Use it in the settings API**

`src/app/api/settings/route.ts`: add `import { getSettings, saveSettings } from "@/lib/settings";` and remove the `prisma` import.

In `GET`, replace

```ts
    let settings = await prisma.settings.findUnique({
      where: { id: "default" },
    });

    if (!settings) {
      settings = await prisma.settings.create({
        data: { id: "default" },
      });
    }

    return NextResponse.json(maskSettingsSecrets(settings));
```
with
```ts
    return NextResponse.json(maskSettingsSecrets(await getSettings()));
```

In `PUT`, replace

```ts
    const settings = await prisma.settings.upsert({
      where: { id: "default" },
      update: validation.data,
      create: { id: "default", ...validation.data },
    });

    return NextResponse.json(maskSettingsSecrets(settings));
```
with
```ts
    return NextResponse.json(maskSettingsSecrets(await saveSettings(validation.data)));
```

- [ ] **Step 6: Switch every other reader**

Add `import { getSettings } from "@/lib/settings";` to each file below, then make the replacement. If `prisma` ends up unused in a file, delete its import.

`src/lib/ai/engine.ts` (in `getAIConfig`):
```ts
  let settings = await prisma.settings.findFirst();
  if (!settings) {
    settings = await prisma.settings.create({ data: { id: "default" } });
  }
```
→
```ts
  const settings = await getSettings();
```

`src/lib/ai/tools.ts` (in `sendInternalEmail`): `const settings = await prisma.settings.findFirst();` → `const settings = await getSettings();`

`src/lib/channels/email.ts`, in `getEmailConfig`: `const settings = await prisma.settings.findFirst();` → `const settings = await getSettings();`
and in `getEmailBranding`:
```ts
  const settings = await prisma.settings.findFirst({
    select: { businessName: true },
  });
```
→
```ts
  const settings = await getSettings();
```

`src/lib/channels/phone.ts`: both `const settings = await prisma.settings.findFirst();` → `const settings = await getSettings();`

`src/lib/channels/sms.ts`: `const settings = await prisma.settings.findFirst();` → `const settings = await getSettings();`

`src/lib/channels/telegram.ts`:
```ts
  const settings = await prisma.settings.findFirst({
    select: { telegramBotToken: true },
  });
  return settings?.telegramBotToken || "";
```
→
```ts
  const settings = await getSettings();
  return settings.telegramBotToken || "";
```

`src/lib/twilio-verify.ts` (no top-level import here, it imports lazily):
```ts
  const { prisma } = await import("@/lib/prisma");
  const settings = await prisma.settings.findFirst({
    select: { twilioToken: true },
  });
  return settings?.twilioToken || "";
```
→
```ts
  const { getSettings } = await import("@/lib/settings");
  const settings = await getSettings();
  return settings.twilioToken || "";
```

`src/lib/ai/semantic-search.ts`:
```ts
  const settings = await prisma.settings.findFirst({
    select: { aiApiKey: true },
  });
```
→
```ts
  const settings = await getSettings();
```

`src/app/api/health/route.ts`:
```ts
    const settings = await prisma.settings.findFirst({
      select: { aiApiKey: true },
    });
```
→
```ts
    const settings = await getSettings();
```

`src/app/api/knowledge/test/route.ts`:
```ts
    const settings = await prisma.settings.findUnique({
      where: { id: "default" },
    });
```
→
```ts
    const settings = await getSettings();
```

Then confirm nothing reads the table directly any more:

Run: `git grep -n "prisma.settings" -- src ':!src/generated' ':!src/lib/settings.ts'`
Expected: no output.

- [ ] **Step 7: Point the old tests at findUnique**

`getSettings()` uses `findUnique`, so the mocks that set `findFirst` need to follow:

Run: `sed -i 's/settings\.findFirst/settings.findUnique/g' tests/unit/ai-engine.test.ts tests/unit/ai-tools.test.ts tests/api/health.test.ts`

- [ ] **Step 8: One-off script for values saved before this change**

Create `scripts/encrypt-secrets.ts`:

```ts
// re-saves every secret so values stored as plain text get encrypted.
// run once after deploying: npx tsx --env-file=.env scripts/encrypt-secrets.ts
import { getSettings, saveSettings } from "../src/lib/settings";
import { SECRET_FIELDS } from "../src/lib/security";

const settings = await getSettings();
const secrets = Object.fromEntries(SECRET_FIELDS.map((f) => [f, settings[f]]));
await saveSettings(secrets);
console.log(`encrypted ${SECRET_FIELDS.length} fields`);
process.exit(0);
```

Run it against your local database: `npx tsx --env-file=.env scripts/encrypt-secrets.ts`
Expected: `encrypted 7 fields`.

Check one value in the database:

Run: `PGPASSWORD='helpplus_dev_2026' /c/ServBay/packages/postgresql/18/bin/psql.exe -h localhost -U helpplus -d helpplus -tAc 'select left("smtpPass", 7) from "Settings"'`
Expected: empty (nothing saved yet) or `enc:v1:`.

- [ ] **Step 9: Check everything**

Run: `npx tsc --noEmit` — Expected: no output.
Run: `npx vitest run` — Expected: all pass.
Manual: in the app, Settings > AI Configuration, enter an API key, save, reload the page, save again without touching the key, then run the psql check above with `"aiApiKey"`. Expected: still `enc:v1:` (not `***`).

- [ ] **Step 10: Commit**

```bash
git add src/lib/settings.ts tests/unit/settings-store.test.ts scripts/encrypt-secrets.ts src/lib/security.ts tests/helpers/fixtures.ts src/app/api src/lib tests/unit/ai-engine.test.ts tests/unit/ai-tools.test.ts tests/api/health.test.ts
git commit -m "load settings through one place, encrypt secrets"
```

---

### Task 4: Hide IC numbers in text

**Files:**
- Create: `src/lib/privacy/ic-mask.ts`, `tests/unit/ic-mask.test.ts`

**Interfaces:**
- Produces: `maskIC(text: string): { text: string; count: number }`, `IC_PLACEHOLDER = "[IC HIDDEN]"`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ic-mask.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { maskIC, IC_PLACEHOLDER } from "@/lib/privacy/ic-mask";

describe("maskIC", () => {
  it.each([
    ["900101-14-5678", "dashes"],
    ["900101145678", "no separators"],
    ["900101 14 5678", "spaces"],
    ["900101-14 5678", "mixed"],
  ])("hides %s (%s)", (ic) => {
    const out = maskIC(`IC saya ${ic} tak boleh semak`);
    expect(out.text).toBe(`IC saya ${IC_PLACEHOLDER} tak boleh semak`);
    expect(out.count).toBe(1);
  });

  it("hides an IC glued to a label", () => {
    expect(maskIC("IC:900101145678.").text).toBe(`IC:${IC_PLACEHOLDER}.`);
  });

  it("hides every IC in the text", () => {
    const out = maskIC("900101-14-5678 dan 851231-10-1234");
    expect(out.text).toBe(`${IC_PLACEHOLDER} dan ${IC_PLACEHOLDER}`);
    expect(out.count).toBe(2);
  });

  it("works across lines", () => {
    expect(maskIC("nama: Ali\nic: 900101145678").count).toBe(1);
  });

  it.each([
    ["012-345 6789", "mobile number"],
    ["0123456789", "10 digits"],
    ["90010114567", "11 digits"],
    ["9001011456789", "13 digits"],
    ["RM 1,234.56", "money"],
    ["2026-10-04", "date"],
  ])("leaves %s alone (%s)", (text) => {
    expect(maskIC(text)).toEqual({ text, count: 0 });
  });

  it("handles empty text", () => {
    expect(maskIC("")).toEqual({ text: "", count: 0 });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/ic-mask.test.ts`
Expected: FAIL, cannot resolve `@/lib/privacy/ic-mask`.

- [ ] **Step 3: Write the masker**

Create `src/lib/privacy/ic-mask.ts`:

```ts
export const IC_PLACEHOLDER = "[IC HIDDEN]";

// malaysian IC: YYMMDD-PB-####, dashes or spaces optional.
// we don't check the date part on purpose, a false positive is cheaper than a leak.
const IC_PATTERN = /(?<!\d)\d{6}[\s-]?\d{2}[\s-]?\d{4}(?!\d)/g;

export function maskIC(text: string): { text: string; count: number } {
  let count = 0;
  const masked = text.replace(IC_PATTERN, () => {
    count++;
    return IC_PLACEHOLDER;
  });
  return { text: masked, count };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/ic-mask.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/privacy/ic-mask.ts tests/unit/ic-mask.test.ts
git commit -m "add ic number masking"
```

---

### Task 5: Pluggable AI provider

One client for OpenAI, DeepSeek, Ollama and any other OpenAI-compatible server. Every message is IC-masked on the way out. Embeddings get their own provider settings because not every provider offers them.

DeepSeek's base URL (`https://api.deepseek.com`) and model name (`deepseek-chat`) and Ollama's OpenAI-compatible endpoint (`http://localhost:11434/v1`) are from their docs as of writing. Check them before relying on them.

**Files:**
- Create: `src/lib/ai/provider.ts`, `src/lib/ai/config.ts`, `tests/unit/ai-provider.test.ts`, `prisma/migrations/20261004000000_ai_provider_fields/migration.sql`
- Modify: `prisma/schema.prisma`, `src/lib/security.ts`, `src/lib/validations.ts`, `tests/helpers/fixtures.ts`, `src/lib/ai/types.ts`, `src/lib/ai/engine.ts`, `src/lib/ai/semantic-search.ts`, `src/app/api/knowledge/test/route.ts`, `src/app/api/health/route.ts`, `tests/api/health.test.ts`, `src/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: `maskIC` (Task 4), `getSettings` (Task 3)
- Produces:
  - `type ProviderKind = "openai" | "deepseek" | "ollama" | "custom"`
  - `interface ProviderConfig { kind: ProviderKind; model: string; apiKey: string; baseUrl?: string }`
  - `toProviderKind(value: string): ProviderKind`
  - `resolveBaseUrl(cfg: ProviderConfig): string | undefined`
  - `maskMessages(messages: ChatMessage[]): ChatMessage[]` where `ChatMessage = OpenAI.ChatCompletionMessageParam`
  - `chatCompletion(cfg: ProviderConfig, opts: ChatOptions): Promise<OpenAI.ChatCompletion>` with `interface ChatOptions { messages: ChatMessage[]; tools?: OpenAI.ChatCompletionTool[]; maxTokens?: number; temperature?: number }`
  - `embed(cfg: ProviderConfig, texts: string[]): Promise<number[][]>`
  - in `config.ts`: `chatConfig(s)`, `embedConfig(s)`, `isConfigured(cfg): boolean`
  - new `Settings` columns: `aiBaseUrl`, `embedProvider`, `embedModel`, `embedApiKey`, `embedBaseUrl`

- [ ] **Step 1: Add the columns**

`prisma/schema.prisma`, in `model Settings`, after `aiApiKey ...`:

```prisma
  aiBaseUrl       String   @default("")
  embedProvider   String   @default("openai")
  embedModel      String   @default("text-embedding-3-small")
  embedApiKey     String   @default("")
  embedBaseUrl    String   @default("")
```

Create `prisma/migrations/20261004000000_ai_provider_fields/migration.sql`:

```sql
ALTER TABLE "Settings" ADD COLUMN "aiBaseUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Settings" ADD COLUMN "embedProvider" TEXT NOT NULL DEFAULT 'openai';
ALTER TABLE "Settings" ADD COLUMN "embedModel" TEXT NOT NULL DEFAULT 'text-embedding-3-small';
ALTER TABLE "Settings" ADD COLUMN "embedApiKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Settings" ADD COLUMN "embedBaseUrl" TEXT NOT NULL DEFAULT '';
```

Apply locally (the local database was created with `db push`, so keep using it there; servers use `prisma migrate deploy`):

Run: `npx prisma db push && npx prisma generate`
Expected: `Your database is now in sync with your Prisma schema.` and `Generated Prisma Client`.

`src/lib/security.ts`: add `"embedApiKey",` to `SECRET_FIELDS`.

`tests/helpers/fixtures.ts`, in `settings` after `telegramBotToken`:

```ts
    aiBaseUrl: "",
    embedProvider: "openai",
    embedModel: "text-embedding-3-small",
    embedApiKey: "emb-key-12345",
    embedBaseUrl: "",
```

`src/lib/validations.ts`, in `updateSettingsSchema` after `aiApiKey`:

```ts
  aiBaseUrl: z.string().max(500).optional(),
  embedProvider: z.string().max(50).optional(),
  embedModel: z.string().max(100).optional(),
  embedApiKey: z.string().max(500).optional(),
  embedBaseUrl: z.string().max(500).optional(),
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/ai-provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const created: { apiKey?: string; baseURL?: string }[] = [];
const chatCreate = vi.fn();
const embedCreate = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: chatCreate } };
    embeddings = { create: embedCreate };
    constructor(opts: { apiKey?: string; baseURL?: string }) {
      created.push(opts);
    }
  },
}));

import { chatCompletion, embed, resolveBaseUrl, toProviderKind, maskMessages } from "@/lib/ai/provider";
import { chatConfig, embedConfig, isConfigured } from "@/lib/ai/config";
import { fixtures } from "../helpers/fixtures";

beforeEach(() => {
  created.length = 0;
  chatCreate.mockReset().mockResolvedValue({ choices: [{ message: { content: "ok" } }] });
  embedCreate.mockReset().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] });
});

describe("provider", () => {
  it("uses the default base url per provider", () => {
    expect(resolveBaseUrl({ kind: "openai", model: "m", apiKey: "k" })).toBeUndefined();
    expect(resolveBaseUrl({ kind: "deepseek", model: "m", apiKey: "k" })).toBe("https://api.deepseek.com");
    expect(resolveBaseUrl({ kind: "ollama", model: "m", apiKey: "" })).toBe("http://localhost:11434/v1");
  });

  it("lets a custom base url win", () => {
    expect(resolveBaseUrl({ kind: "ollama", model: "m", apiKey: "", baseUrl: "http://gpu-box:11434/v1" })).toBe(
      "http://gpu-box:11434/v1"
    );
  });

  it("maps unknown provider names to openai", () => {
    expect(toProviderKind("claude")).toBe("openai");
    expect(toProviderKind("deepseek")).toBe("deepseek");
  });

  it("masks IC numbers before sending a chat", async () => {
    await chatCompletion(
      { kind: "deepseek", model: "deepseek-chat", apiKey: "k" },
      { messages: [{ role: "user", content: "IC saya 900101-14-5678" }] }
    );
    const sent = chatCreate.mock.calls[0][0];
    expect(sent.messages[0].content).toBe("IC saya [IC HIDDEN]");
    expect(sent.model).toBe("deepseek-chat");
    expect(created[0].baseURL).toBe("https://api.deepseek.com");
  });

  it("masks text parts of multi-part messages", () => {
    const out = maskMessages([
      { role: "user", content: [{ type: "text", text: "ic 900101145678" }] },
    ]);
    expect(out[0].content).toEqual([{ type: "text", text: "ic [IC HIDDEN]" }]);
  });

  it("gives local servers a dummy key", async () => {
    await chatCompletion({ kind: "ollama", model: "llama3.1", apiKey: "" }, { messages: [] });
    expect(created[0].apiKey).toBe("local");
  });

  it("refuses a custom provider without a url", async () => {
    await expect(
      chatCompletion({ kind: "custom", model: "x", apiKey: "" }, { messages: [] })
    ).rejects.toThrow(/base URL/);
  });

  it("masks and returns embeddings", async () => {
    const out = await embed({ kind: "openai", model: "text-embedding-3-small", apiKey: "k" }, ["ic 900101145678"]);
    expect(embedCreate.mock.calls[0][0].input).toEqual(["ic [IC HIDDEN]"]);
    expect(out).toEqual([[0.1, 0.2]]);
  });
});

describe("config", () => {
  it("builds the chat config from settings", () => {
    const cfg = chatConfig({ ...fixtures.settings, aiProvider: "deepseek", aiModel: "deepseek-chat" });
    expect(cfg).toEqual({ kind: "deepseek", model: "deepseek-chat", apiKey: "sk-test-key-12345", baseUrl: "" });
  });

  it("reuses the chat key for embeddings on the same provider", () => {
    const cfg = embedConfig({ ...fixtures.settings, embedApiKey: "" });
    expect(cfg.apiKey).toBe("sk-test-key-12345");
  });

  it("does not reuse the chat key across providers", () => {
    const cfg = embedConfig({ ...fixtures.settings, aiProvider: "deepseek", embedApiKey: "" });
    expect(cfg.apiKey).toBe("");
  });

  it("treats local providers as configured without a key", () => {
    expect(isConfigured({ kind: "ollama", model: "m", apiKey: "" })).toBe(true);
    expect(isConfigured({ kind: "openai", model: "m", apiKey: "" })).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `npx vitest run tests/unit/ai-provider.test.ts`
Expected: FAIL, cannot resolve `@/lib/ai/provider`.

- [ ] **Step 4: Write the provider**

Create `src/lib/ai/provider.ts`:

```ts
import OpenAI from "openai";
import { maskIC } from "@/lib/privacy/ic-mask";

export type ProviderKind = "openai" | "deepseek" | "ollama" | "custom";

export interface ProviderConfig {
  kind: ProviderKind;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export type ChatMessage = OpenAI.ChatCompletionMessageParam;

export interface ChatOptions {
  messages: ChatMessage[];
  tools?: OpenAI.ChatCompletionTool[];
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_BASE_URL: Record<ProviderKind, string | undefined> = {
  openai: undefined,
  deepseek: "https://api.deepseek.com",
  ollama: "http://localhost:11434/v1",
  custom: undefined,
};

export function toProviderKind(value: string): ProviderKind {
  return value === "deepseek" || value === "ollama" || value === "custom" ? value : "openai";
}

export function resolveBaseUrl(cfg: ProviderConfig): string | undefined {
  return cfg.baseUrl?.trim() || DEFAULT_BASE_URL[cfg.kind];
}

function createClient(cfg: ProviderConfig): OpenAI {
  const baseURL = resolveBaseUrl(cfg);
  if (cfg.kind === "custom" && !baseURL) {
    throw new Error("custom provider needs a base URL");
  }
  // local servers ignore the key, but the sdk refuses an empty one
  return new OpenAI({ apiKey: cfg.apiKey || "local", baseURL });
}

export function maskMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (typeof m.content === "string") {
      return { ...m, content: maskIC(m.content).text } as ChatMessage;
    }
    if (Array.isArray(m.content)) {
      const parts = (m.content as Array<{ type: string; text?: string }>).map((p) =>
        p.type === "text" && typeof p.text === "string" ? { ...p, text: maskIC(p.text).text } : p
      );
      return { ...m, content: parts } as ChatMessage;
    }
    return m;
  });
}

export async function chatCompletion(cfg: ProviderConfig, opts: ChatOptions): Promise<OpenAI.ChatCompletion> {
  const client = createClient(cfg);
  return client.chat.completions.create({
    model: cfg.model,
    messages: maskMessages(opts.messages),
    tools: opts.tools?.length ? opts.tools : undefined,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    stream: false,
  });
}

export async function embed(cfg: ProviderConfig, texts: string[]): Promise<number[][]> {
  const client = createClient(cfg);
  const res = await client.embeddings.create({
    model: cfg.model,
    input: texts.map((t) => maskIC(t).text.slice(0, 8000)),
  });
  return res.data.map((d) => d.embedding as number[]);
}
```

Create `src/lib/ai/config.ts`:

```ts
import type { Settings } from "@/generated/prisma/client";
import { toProviderKind, type ProviderConfig } from "./provider";

type ChatFields = Pick<Settings, "aiProvider" | "aiModel" | "aiApiKey" | "aiBaseUrl">;
type EmbedFields = ChatFields & Pick<Settings, "embedProvider" | "embedModel" | "embedApiKey" | "embedBaseUrl">;

export function chatConfig(s: ChatFields): ProviderConfig {
  return { kind: toProviderKind(s.aiProvider), model: s.aiModel, apiKey: s.aiApiKey, baseUrl: s.aiBaseUrl };
}

export function embedConfig(s: EmbedFields): ProviderConfig {
  const kind = toProviderKind(s.embedProvider);
  // same provider as chat and no separate key: reuse the chat key
  const apiKey = s.embedApiKey || (kind === toProviderKind(s.aiProvider) ? s.aiApiKey : "");
  return { kind, model: s.embedModel, apiKey, baseUrl: s.embedBaseUrl };
}

export function isConfigured(cfg: ProviderConfig): boolean {
  return cfg.kind === "ollama" || cfg.kind === "custom" || cfg.apiKey.length > 0;
}
```

Run: `npx vitest run tests/unit/ai-provider.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Use it in the chat engine**

`src/lib/ai/types.ts`, in `AIConfig`, add after `apiKey: string;`:

```ts
  baseUrl: string;
```

`src/lib/ai/engine.ts`:

Replace `import OpenAI from "openai";` with:

```ts
import type OpenAI from "openai";
import { chatCompletion } from "./provider";
import { chatConfig, isConfigured } from "./config";
```

In `getAIConfig`, after `apiKey: settings.aiApiKey,` add `baseUrl: settings.aiBaseUrl,`.

Add this function right above `export async function chat(`:

```ts
function providerFor(config: AIConfig) {
  return chatConfig({
    aiProvider: config.provider,
    aiModel: config.model,
    aiApiKey: config.apiKey,
    aiBaseUrl: config.baseUrl,
  });
}
```

In `chat`, replace `if (!config.apiKey) {` with `if (!isConfigured(providerFor(config))) {`.

In `callAI`, replace

```ts
  const openai = new OpenAI({ apiKey: config.apiKey });

  let response;
  try {
    response = await openai.chat.completions.create({
      model: config.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      tools: helplusTools as OpenAI.ChatCompletionTool[],
      max_tokens: config.maxTokens,
      temperature: config.temperature,
    });
  } catch {
```
with
```ts
  let response;
  try {
    response = await chatCompletion(providerFor(config), {
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      tools: helplusTools as OpenAI.ChatCompletionTool[],
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    });
  } catch {
```

Run: `npx vitest run tests/unit/ai-engine.test.ts`
Expected: PASS.

- [ ] **Step 6: Use it in the knowledge test endpoint**

`src/app/api/knowledge/test/route.ts`:

Replace `import OpenAI from "openai";` with:

```ts
import { chatCompletion } from "@/lib/ai/provider";
import { chatConfig, isConfigured } from "@/lib/ai/config";
```

Replace `if (!settings?.aiApiKey) {` with:

```ts
    const ai = chatConfig(settings);
    if (!isConfigured(ai)) {
```

Replace

```ts
    const openai = new OpenAI({
      apiKey: settings.aiApiKey,
    });

    const completion = await openai.chat.completions.create({
      model: settings.aiModel || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question.trim() },
      ],
      max_tokens: settings.maxTokens || 2048,
      temperature: settings.temperature ?? 0.7,
    });
```
with
```ts
    const completion = await chatCompletion(
      { ...ai, model: ai.model || "gpt-4o-mini" },
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question.trim() },
        ],
        maxTokens: settings.maxTokens || 2048,
        temperature: settings.temperature ?? 0.7,
      }
    );
```

- [ ] **Step 7: Use it for embeddings**

`src/lib/ai/semantic-search.ts`:

Replace the header comment (lines 1-9) with:

```ts
// knowledge base search: embeddings when a provider is set up, keyword match otherwise.
// vectors live in KnowledgeEntry.metadata for now.
```

Add imports:

```ts
import { embed } from "./provider";
import { embedConfig, isConfigured } from "./config";
```

Replace the whole `generateEmbedding` function (with its comment) with:

```ts
async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const cfg = embedConfig(await getSettings());
    if (!isConfigured(cfg)) return null;
    const [vector] = await embed(cfg, [text]);
    return vector ?? null;
  } catch (error) {
    logger.error("Failed to generate embedding:", error);
    return null;
  }
}
```

In `searchKnowledgeBase`, replace

```ts
  const settings = await getSettings();

  let results: SearchResult[];

  if (settings?.aiApiKey) {
```
with
```ts
  const cfg = embedConfig(await getSettings());

  let results: SearchResult[];

  if (isConfigured(cfg)) {
```
and `queryEmbedding = await generateEmbedding(query, settings.aiApiKey);` with `queryEmbedding = await generateEmbedding(query);`.

Change `indexKnowledgeEntry` to drop the key parameter (nothing calls it yet):

```ts
export async function indexKnowledgeEntry(entryId: string): Promise<boolean> {
```
and inside it `const embedding = await generateEmbedding(text, apiKey);` → `const embedding = await generateEmbedding(text);`. Remove the `/** Generate and store embedding... */` comment above it.

- [ ] **Step 8: Provider-neutral health check**

`src/app/api/health/route.ts`: add

```ts
import { resolveBaseUrl } from "@/lib/ai/provider";
import { chatConfig, isConfigured } from "@/lib/ai/config";
```

Replace the block from `// OpenAI reachability check` to the end of its `catch` with:

```ts
  // AI provider reachability
  try {
    const ai = chatConfig(await getSettings());
    if (isConfigured(ai)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const base = resolveBaseUrl(ai) ?? "https://api.openai.com/v1";
      const res = await fetch(`${base.replace(/\/$/, "")}/models`, {
        headers: ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {},
        signal: controller.signal,
      });
      clearTimeout(timeout);
      checks.ai = res.ok ? "reachable" : "error";
    } else {
      checks.ai = "not_configured";
    }
  } catch {
    checks.ai = "unreachable";
  }
```


`tests/api/health.test.ts`: rename the test `should report openai as not_configured when no API key` to `should report ai as not_configured when no API key` and change `expect(data.services.openai)` to `expect(data.services.ai)`.

- [ ] **Step 9: Settings page, AI section**

`src/app/(dashboard)/settings/page.tsx`:

In `interface SettingsData`, after `aiApiKey: string;` add:

```ts
  aiBaseUrl: string;
  embedProvider: string;
  embedModel: string;
  embedApiKey: string;
  embedBaseUrl: string;
```

In `sectionFields.ai` use:

```ts
  ai: [
    "aiProvider",
    "aiModel",
    "aiBaseUrl",
    "aiApiKey",
    "maxTokens",
    "temperature",
    "embedProvider",
    "embedModel",
    "embedBaseUrl",
    "embedApiKey",
  ],
```

In the defaults object, after `aiApiKey: "",` add:

```ts
  aiBaseUrl: "",
  embedProvider: "openai",
  embedModel: "text-embedding-3-small",
  embedApiKey: "",
  embedBaseUrl: "",
```

Replace the whole `AISection` function with:

```tsx
const AI_PRESETS: Record<string, { model: string; baseUrl: string }> = {
  openai: { model: "gpt-4o-mini", baseUrl: "" },
  deepseek: { model: "deepseek-chat", baseUrl: "https://api.deepseek.com" },
  ollama: { model: "llama3.1", baseUrl: "http://localhost:11434/v1" },
  custom: { model: "", baseUrl: "" },
};

const EMBED_PRESETS: Record<string, { model: string; baseUrl: string }> = {
  openai: { model: "text-embedding-3-small", baseUrl: "" },
  ollama: { model: "nomic-embed-text", baseUrl: "http://localhost:11434/v1" },
  custom: { model: "", baseUrl: "" },
};

function AISection({
  data,
  update,
}: {
  data: SettingsData;
  update: (field: keyof SettingsData, value: string | number) => void;
}) {
  const local = (p: string) => p === "ollama" || p === "custom";

  return (
    <div className="space-y-5">
      <FormField label="AI provider" description="DeepSeek and local servers use the same OpenAI-style API.">
        <SelectInput
          value={data.aiProvider}
          onChange={(v) => {
            update("aiProvider", v);
            update("aiModel", AI_PRESETS[v]?.model ?? "");
            update("aiBaseUrl", AI_PRESETS[v]?.baseUrl ?? "");
          }}
          options={[
            { value: "openai", label: "OpenAI (ChatGPT)" },
            { value: "deepseek", label: "DeepSeek" },
            { value: "ollama", label: "Ollama (local)" },
            { value: "custom", label: "Other OpenAI-compatible server" },
          ]}
        />
      </FormField>
      <FormField label="Model" description="Exact model name, e.g. gpt-4o-mini, deepseek-chat, llama3.1.">
        <TextInput value={data.aiModel} onChange={(v) => update("aiModel", v)} placeholder="Model name" />
      </FormField>
      <FormField label="Server URL" description="Leave empty for OpenAI.">
        <TextInput value={data.aiBaseUrl} onChange={(v) => update("aiBaseUrl", v)} placeholder="https://..." />
      </FormField>
      <FormField label="API key" description={local(data.aiProvider) ? "Usually not needed for local servers." : "Your provider API key."}>
        <PasswordInput
          value={data.aiApiKey}
          onChange={(v) => update("aiApiKey", v)}
          placeholder={local(data.aiProvider) ? "Optional" : "Enter your API key"}
        />
      </FormField>
      <FormField label="Max tokens" description="Longest answer the AI may write.">
        <SliderInput
          value={data.maxTokens}
          onChange={(v) => update("maxTokens", v)}
          min={256}
          max={8192}
          step={256}
          displayValue={data.maxTokens.toLocaleString()}
        />
      </FormField>
      <FormField label="Temperature" description="Lower is more focused, higher is more creative.">
        <SliderInput
          value={data.temperature}
          onChange={(v) => update("temperature", v)}
          min={0}
          max={2}
          step={0.1}
          displayValue={data.temperature.toFixed(1)}
        />
      </FormField>

      <div className="pt-5 border-t border-helplus-border space-y-5">
        <div>
          <h4 className="text-sm font-semibold text-helplus-text">Similar-ticket search</h4>
          <p className="text-xs text-helplus-text-light mt-1">
            Needs an embeddings model. Not every provider offers one, so this can use a different provider.
          </p>
        </div>
        <FormField label="Embeddings provider">
          <SelectInput
            value={data.embedProvider}
            onChange={(v) => {
              update("embedProvider", v);
              update("embedModel", EMBED_PRESETS[v]?.model ?? "");
              update("embedBaseUrl", EMBED_PRESETS[v]?.baseUrl ?? "");
            }}
            options={[
              { value: "openai", label: "OpenAI" },
              { value: "ollama", label: "Ollama (local)" },
              { value: "custom", label: "Other OpenAI-compatible server" },
            ]}
          />
        </FormField>
        <FormField label="Embeddings model">
          <TextInput value={data.embedModel} onChange={(v) => update("embedModel", v)} placeholder="Model name" />
        </FormField>
        <FormField label="Server URL" description="Leave empty for OpenAI.">
          <TextInput value={data.embedBaseUrl} onChange={(v) => update("embedBaseUrl", v)} placeholder="https://..." />
        </FormField>
        <FormField label="API key" description="Leave empty to reuse the key above when it's the same provider.">
          <PasswordInput value={data.embedApiKey} onChange={(v) => update("embedApiKey", v)} placeholder="Optional" />
        </FormField>
      </div>
    </div>
  );
}
```


- [ ] **Step 10: Check everything**

Run: `npx tsc --noEmit` — Expected: no output.
Run: `npx vitest run` — Expected: all pass.
Run: `git grep -n "new OpenAI\|api.openai.com" -- src ':!src/generated'`
Expected: only `src/lib/channels/phone.ts` (Whisper transcription, phone channel, left as is) and the `https://api.openai.com/v1` fallback in `health/route.ts`.
Manual: Settings > AI Configuration shows the four providers and the embeddings block; saving works.

- [ ] **Step 11: Commit**

```bash
git add prisma src/lib tests "src/app/(dashboard)/settings/page.tsx" src/app/api
git commit -m "pluggable ai provider, mask ic before every call"
```

---

### Task 6: Indigo theme and Plex fonts

**Files:**
- Create: `tests/unit/theme-contrast.test.ts`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`, every `.tsx` under `src/` that uses `text-helplus-primary` as text colour

**Interfaces:**
- Produces: CSS tokens `--helplus-*` (same names as now) plus a new `--helplus-link` and Tailwind class `text-helplus-link`. Fonts as `--font-plex-sans` / `--font-plex-mono`.

Primary indigo can't be readable both as a button background (white text on it) and as text on the dark background. So text that used the primary colour now uses `--helplus-link`, which is lighter in dark mode.

- [ ] **Step 1: Write the failing contrast test**

Create `tests/unit/theme-contrast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector + " {");
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--helplus-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const PAIRS: [string, string][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["text-light", "bg"],
  ["text-light", "surface"],
  ["link", "bg"],
  ["link", "surface"],
  ["link", "primary-50"],
  ["#FFFFFF", "primary"],
  ["danger", "surface"],
  ["success", "surface"],
  ["warning", "surface"],
];

for (const [name, selector] of [["light", ":root"], ["dark", ".dark"]] as const) {
  describe(`${name} theme contrast`, () => {
    const t = tokens(selector);
    it.each(PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
      const a = fg.startsWith("#") ? fg : t[fg];
      const b = t[bg];
      expect(a, `missing --helplus-${fg}`).toBeDefined();
      expect(b, `missing --helplus-${bg}`).toBeDefined();
      expect(contrast(a, b)).toBeGreaterThanOrEqual(4.5);
    });
  });
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/theme-contrast.test.ts`
Expected: FAIL, `missing --helplus-link` (and some old colours below 4.5).

- [ ] **Step 3: Replace the tokens**

In `src/app/globals.css`, replace the whole `:root { ... }` block and the whole `.dark { ... }` block with:

```css
:root {
  --helplus-primary: #3B3FA6;
  --helplus-primary-dark: #2F3388;
  --helplus-primary-light: #C7C9FF;
  --helplus-primary-50: #EEEEFB;
  --helplus-primary-100: #E0E1F7;
  --helplus-accent: #5B5FD6;
  --helplus-accent-light: #E0E1F7;
  --helplus-link: #3B3FA6;
  --helplus-bg: #F6F6F3;
  --helplus-surface: #FFFFFF;
  --helplus-text: #16181F;
  --helplus-text-light: #5B6070;
  --helplus-border: #E4E3DE;
  --helplus-sidebar: #16181F;
  --helplus-sidebar-hover: #23262F;
  --helplus-sidebar-active: #23262F;
  --helplus-success: #067647;
  --helplus-warning: #B54708;
  --helplus-danger: #B42318;
}

.dark {
  --helplus-primary: #4B4FC4;
  --helplus-primary-dark: #3B3FA6;
  --helplus-primary-light: #A5A8FF;
  --helplus-primary-50: #1E2040;
  --helplus-primary-100: #272A55;
  --helplus-accent: #A5A8FF;
  --helplus-accent-light: #272A55;
  --helplus-link: #A5A8FF;
  --helplus-bg: #0F1015;
  --helplus-surface: #16181F;
  --helplus-text: #ECECF1;
  --helplus-text-light: #A9ACBA;
  --helplus-border: #2A2D36;
  --helplus-sidebar: #0B0C10;
  --helplus-sidebar-hover: #1C1E26;
  --helplus-sidebar-active: #1C1E26;
  --helplus-success: #47CD89;
  --helplus-warning: #FDB022;
  --helplus-danger: #F97066;
}
```

In the `@theme inline` block, add after `--color-helplus-danger: var(--helplus-danger);`:

```css
  --color-helplus-link: var(--helplus-link);
```

and replace

```css
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
```
with
```css
  --font-sans: var(--font-plex-sans);
  --font-mono: var(--font-plex-mono);
```

Run: `npx vitest run tests/unit/theme-contrast.test.ts`
Expected: PASS (22 cases).

- [ ] **Step 4: Move text that used primary onto the link token**

Run (from the repo root, Git Bash):

```bash
grep -rlE 'text-helplus-primary([^-[:alnum:]]|$)' src --include=*.tsx | xargs sed -i -E 's/text-helplus-primary([^-[:alnum:]]|$)/text-helplus-link\1/g'
```

Check: `git grep -nE 'text-helplus-primary([^-[:alnum:]]|$)' -- src` → no output.
Check: `git grep -c "text-helplus-link" -- src | head` → several files listed.

- [ ] **Step 5: Plex fonts and metadata**

`src/app/layout.tsx`, replace the font import and setup:

```ts
import { Inter } from "next/font/google";
```
→
```ts
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
```

```ts
const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
```
→
```ts
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});
```

`<html lang="en" className={`${inter.variable} h-full antialiased`}>` → `<html lang="en" className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}>`

In `metadata`: `title: "Help+"`, `description: "Support desk for teams that run on WhatsApp"`.

- [ ] **Step 6: Check everything**

Run: `npx tsc --noEmit` — Expected: no output.
Run: `npx vitest run` — Expected: all pass.
Run: `npx next build` (stop the dev server first) — Expected: build finishes with the route table.
Manual: `npm run dev`, open http://localhost:3000, log in. Expected: indigo buttons, warm grey background, Plex font. Toggle dark mode from the header: links and text readable.

- [ ] **Step 7: Commit**

```bash
git add src tests/unit/theme-contrast.test.ts
git commit -m "indigo theme and plex fonts"
```

---

### Task 7: New app shell

Desktop: dark sidebar with 7 links. Phone: bottom tabs (Dashboard, Tickets, Inbox, Clients, More). Pages that used to be separate menu items now sit under a tab bar: Dashboard (Overview, Analytics), Library (Articles, Saved replies, Test AI) and Settings (all the old system pages). "Inbox" is the old Conversations page; it goes away in stage 2 when chats move into tickets.

**Files:**
- Create: `src/components/layout/nav-items.ts`, `src/components/layout/bottom-tabs.tsx`, `src/components/layout/section-tabs.tsx`, `src/app/(dashboard)/more/page.tsx`, `tests/unit/nav-items.test.ts`
- Modify: `src/components/layout/sidebar.tsx` (rewrite), `src/app/(dashboard)/layout.tsx`, `src/components/layout/header.tsx`, `scripts/smoke-pages.mjs`

**Interfaces:**
- Produces (from `nav-items.ts`):
  - `interface NavItem { name: string; href: string; icon: LucideIcon; match?: string[] }`
  - `interface SectionLink { name: string; href: string }`, `interface SectionGroup { name: string; items: SectionLink[] }`
  - `mainNav: NavItem[]`, `phoneTabs: NavItem[]`, `moreNav: NavItem[]`, `sectionGroups: SectionGroup[]`
  - `isActive(pathname: string, item: NavItem): boolean`
  - `groupFor(pathname: string): SectionGroup | null`
  - `activeHref(group: SectionGroup, pathname: string): string | null`
  - `moreActive(pathname: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/nav-items.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  mainNav,
  phoneTabs,
  sectionGroups,
  isActive,
  groupFor,
  activeHref,
  moreActive,
} from "@/components/layout/nav-items";

const item = (name: string) => mainNav.find((i) => i.name === name)!;

describe("isActive", () => {
  it("matches the dashboard only on / and analytics", () => {
    expect(isActive("/", item("Dashboard"))).toBe(true);
    expect(isActive("/analytics", item("Dashboard"))).toBe(true);
    expect(isActive("/tickets", item("Dashboard"))).toBe(false);
  });

  it("matches sub-paths but not look-alike paths", () => {
    expect(isActive("/tickets/42", item("Tickets"))).toBe(true);
    expect(isActive("/ticketsx", item("Tickets"))).toBe(false);
  });

  it("keeps settings active on the old system pages", () => {
    for (const p of ["/settings", "/team", "/sla", "/webhooks", "/admin", "/activity", "/api-docs"]) {
      expect(isActive(p, item("Settings"))).toBe(true);
    }
  });

  it("keeps library active on saved replies and the AI test page", () => {
    expect(isActive("/canned-responses", item("Library"))).toBe(true);
    expect(isActive("/knowledge/test", item("Library"))).toBe(true);
  });
});

describe("section groups", () => {
  it("finds the group for a page", () => {
    expect(groupFor("/sla")?.name).toBe("Settings");
    expect(groupFor("/canned-responses")?.name).toBe("Library");
    expect(groupFor("/")?.name).toBe("Dashboard");
    expect(groupFor("/tickets")).toBeNull();
  });

  it("picks the most specific tab", () => {
    const library = sectionGroups.find((g) => g.name === "Library")!;
    expect(activeHref(library, "/knowledge/test")).toBe("/knowledge/test");
    expect(activeHref(library, "/knowledge")).toBe("/knowledge");
  });
});

describe("phone nav", () => {
  it("shows four tabs plus More", () => {
    expect(phoneTabs.map((i) => i.name)).toEqual(["Dashboard", "Tickets", "Inbox", "Clients"]);
  });

  it("lights up More for pages that live behind it", () => {
    expect(moreActive("/more")).toBe(true);
    expect(moreActive("/channels")).toBe(true);
    expect(moreActive("/team")).toBe(true);
    expect(moreActive("/tickets")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/unit/nav-items.test.ts`
Expected: FAIL, cannot resolve `@/components/layout/nav-items`.

- [ ] **Step 3: Write the nav definitions**

Create `src/components/layout/nav-items.ts`:

```ts
import {
  BookOpen,
  Building2,
  LayoutDashboard,
  MessagesSquare,
  RadioTower,
  Settings,
  Ticket,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  match?: string[];
}

export interface SectionLink {
  name: string;
  href: string;
}

export interface SectionGroup {
  name: string;
  items: SectionLink[];
}

export const sectionGroups: SectionGroup[] = [
  {
    name: "Dashboard",
    items: [
      { name: "Overview", href: "/" },
      { name: "Analytics", href: "/analytics" },
    ],
  },
  {
    name: "Library",
    items: [
      { name: "Articles", href: "/knowledge" },
      { name: "Saved replies", href: "/canned-responses" },
      { name: "Test AI", href: "/knowledge/test" },
    ],
  },
  {
    name: "Settings",
    items: [
      { name: "General & AI", href: "/settings" },
      { name: "Team", href: "/team" },
      { name: "Business hours", href: "/business-hours" },
      { name: "SLA rules", href: "/sla" },
      { name: "Automation", href: "/automation" },
      { name: "Integrations", href: "/webhooks" },
      { name: "Users & roles", href: "/admin" },
      { name: "Audit log", href: "/activity" },
      { name: "Developer API", href: "/api-docs" },
    ],
  },
];

const hrefsOf = (group: string) =>
  sectionGroups.find((g) => g.name === group)!.items.map((i) => i.href);

// "Inbox" is the old conversations page, it goes away once chats live inside tickets
export const mainNav: NavItem[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard, match: hrefsOf("Dashboard") },
  { name: "Tickets", href: "/tickets", icon: Ticket },
  { name: "Inbox", href: "/conversations", icon: MessagesSquare },
  { name: "Clients", href: "/customers", icon: Building2 },
  { name: "Library", href: "/knowledge", icon: BookOpen, match: hrefsOf("Library") },
  { name: "Sources", href: "/channels", icon: RadioTower },
  { name: "Settings", href: "/settings", icon: Settings, match: hrefsOf("Settings") },
];

export const phoneTabs = mainNav.slice(0, 4);
export const moreNav = mainNav.slice(4);

function matches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function isActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.match ?? [])].some((h) => matches(pathname, h));
}

export function groupFor(pathname: string): SectionGroup | null {
  return sectionGroups.find((g) => g.items.some((i) => matches(pathname, i.href))) ?? null;
}

export function activeHref(group: SectionGroup, pathname: string): string | null {
  const hits = group.items.filter((i) => matches(pathname, i.href));
  hits.sort((a, b) => b.href.length - a.href.length);
  return hits[0]?.href ?? null;
}

export function moreActive(pathname: string): boolean {
  return pathname === "/more" || moreNav.some((i) => isActive(pathname, i));
}
```

Run: `npx vitest run tests/unit/nav-items.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 4: Sidebar**

Replace all of `src/components/layout/sidebar.tsx` with:

```tsx
"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive, mainNav } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-56 flex-shrink-0 flex-col bg-helplus-sidebar text-white">
      <div className="flex items-center gap-2.5 h-16 px-5">
        <Image src="/helplus.svg" alt="" width={24} height={24} />
        <span className="text-[17px] font-semibold tracking-tight">
          Help<span className="text-helplus-primary-light">+</span>
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {mainNav.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 h-10 px-3 rounded-md text-sm transition-colors",
                active
                  ? "bg-helplus-sidebar-active text-white font-medium shadow-[inset_2px_0_0_var(--helplus-primary-light)]"
                  : "text-white/70 hover:bg-helplus-sidebar-hover hover:text-white"
              )}
            >
              <item.icon className="h-[17px] w-[17px]" strokeWidth={1.75} />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 5: Bottom tabs and section tabs**

Create `src/components/layout/bottom-tabs.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActive, moreActive, phoneTabs } from "./nav-items";

export function BottomTabs() {
  const pathname = usePathname();
  const tabs = [
    ...phoneTabs.map((i) => ({ name: i.name, href: i.href, icon: i.icon, active: isActive(pathname, i) })),
    { name: "More", href: "/more", icon: MoreHorizontal, active: moreActive(pathname) },
  ];

  return (
    <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 flex border-t border-helplus-border bg-helplus-surface pb-[env(safe-area-inset-bottom)]">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-1 h-14 text-[11px]",
            t.active ? "text-helplus-link font-semibold" : "text-helplus-text-light"
          )}
        >
          <t.icon className="h-5 w-5" strokeWidth={1.75} />
          {t.name}
        </Link>
      ))}
    </nav>
  );
}
```

Create `src/components/layout/section-tabs.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { activeHref, groupFor } from "./nav-items";

export function SectionTabs() {
  const pathname = usePathname();
  const group = groupFor(pathname);
  if (!group) return null;
  const current = activeHref(group, pathname);

  return (
    <div className="flex items-end gap-1 h-11 px-4 md:px-6 border-b border-helplus-border bg-helplus-surface overflow-x-auto">
      {group.items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={cn(
            "whitespace-nowrap inline-flex items-center h-10 px-3 text-sm border-b-2 -mb-px",
            i.href === current
              ? "border-helplus-primary text-helplus-text font-medium"
              : "border-transparent text-helplus-text-light hover:text-helplus-text"
          )}
        >
          {i.name}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Layout, More page, header padding**

Replace all of `src/app/(dashboard)/layout.tsx` with:

```tsx
import { Sidebar } from "@/components/layout/sidebar";
import { BottomTabs } from "@/components/layout/bottom-tabs";
import { SectionTabs } from "@/components/layout/section-tabs";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden pb-14 md:pb-0">
        <SectionTabs />
        {children}
      </main>
      <BottomTabs />
    </div>
  );
}
```

Create `src/app/(dashboard)/more/page.tsx`:

```tsx
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Header } from "@/components/layout/header";
import { moreNav, sectionGroups } from "@/components/layout/nav-items";

export default function MorePage() {
  const settings = sectionGroups.find((g) => g.name === "Settings")!;

  return (
    <>
      <Header title="More" />
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <LinkList title="Pages" items={moreNav.map((i) => ({ name: i.name, href: i.href }))} />
        <LinkList title="Settings" items={settings.items} />
      </div>
    </>
  );
}

function LinkList({ title, items }: { title: string; items: { name: string; href: string }[] }) {
  return (
    <section>
      <h3 className="px-1 mb-2 text-xs font-medium text-helplus-text-light">{title}</h3>
      <div className="rounded-md border border-helplus-border bg-helplus-surface divide-y divide-helplus-border">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className="flex items-center justify-between h-12 px-4 text-sm text-helplus-text"
          >
            {i.name}
            <ChevronRight className="h-4 w-4 text-helplus-text-light" />
          </Link>
        ))}
      </div>
    </section>
  );
}
```

`src/components/layout/header.tsx`: in the `<header className="...">`, change `px-6 py-4` to `px-4 md:px-6 py-3 md:py-4`, and change `text-xl font-semibold` on the `<h2>` to `text-lg md:text-xl font-semibold`.

`scripts/smoke-pages.mjs`: add `"/more"` to the end of `PAGES`.

- [ ] **Step 7: Check everything**

Run: `npx tsc --noEmit` — Expected: no output.
Run: `npx vitest run` — Expected: all pass.
Run: `npm run lint` — Expected: no errors (the one old `<img>` warning in `channels/page.tsx` is fine).
Run: `npm run smoke` (dev server running) — Expected: `no runtime errors`.
Manual, desktop (1280 wide): sidebar shows Dashboard, Tickets, Inbox, Clients, Library, Sources, Settings. Clicking Settings shows the tab bar with the 9 old system pages; clicking SLA rules keeps Settings highlighted.
Manual, phone (Chrome devtools, iPhone 12 size): no sidebar, bottom tabs visible and not covering content, More lists Library, Sources, Settings and the 9 settings pages.

- [ ] **Step 8: Commit**

```bash
git add src/components/layout "src/app/(dashboard)" tests/unit/nav-items.test.ts scripts/smoke-pages.mjs
git commit -m "new app shell, bottom tabs on phone"
```

---

## Done when

- `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, `npx next build` and `npm run smoke` all pass.
- No page crashes with `.map is not a function`.
- `prisma.settings` is only touched in `src/lib/settings.ts`; secrets in the database start with `enc:v1:`.
- Saving the settings page without retyping a key keeps the key.
- Every AI call goes through `src/lib/ai/provider.ts` (the unused Whisper helper in the phone channel was removed).
- The app is indigo, uses Plex, and is usable on a phone at the shell level.

Next: plan 1B (companies, roles, per-company settings) builds on `getSettings()` and `provider.ts` from here.
