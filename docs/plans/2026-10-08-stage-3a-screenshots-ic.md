# Stage 3A: Screenshots with IC Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff can attach screenshots to tickets, from quick add, the ticket page and incoming WhatsApp images. The server reads each image with OCR, covers Malaysian IC numbers with black boxes, and keeps the encrypted original for staff only. Every view of an original is audit-logged, and originals are deleted N days after the ticket closes. Images the OCR isn't sure about are marked "needs check" and held back until staff confirm or cover them by hand.

**Architecture:** Five pieces, plus one process function that drives them:
- **Storage layer** (`src/lib/storage/`): stores files under company-scoped keys. Local disk now; an S3/MinIO driver comes with deployment.
- **Encrypted originals:** stored with the existing AES-256-GCM key (`HELPLUS_SECRET_KEY`).
- **OCR adapter** (`src/lib/ocr/`): wraps tesseract.js, which runs inside Node with nothing to install.
- **Pure functions** (`src/lib/privacy/ic-image.ts`): find IC numbers in OCR output and decide "needs check". `sharp` draws the boxes.
- **`Attachment` table:** tracks status (`pending`, `clean`, `masked`, `needs_check`) and the storage keys.

`processAttachment(id)` ties these together. It runs straight after upload, and the worker retries anything left pending.

**Tech Stack:** Next.js 16 route handlers (multipart `request.formData()`), Prisma 7 with the tenant extension, `tesseract.js` 7, `sharp` 0.35 (already installed with Next), Vitest.

Spec: `docs/specs/2026-10-04-helplus-design.md`, section "3. Intake", parts "IC masking" and "File storage", plus "Screenshots" in section 4. WhatsApp chat export, old-system import and the silent bot are stages 3B and 3C.

## Global Constraints

- Code name `helplus`, display name "Help+". No "owly" anywhere except `LICENSE`.
- Comments only when needed: one short plain line, written the way a person would ("copy before any await, ios blocks it after"). No multi-line explanations, no "This function...", no emoji.
- Commit messages short and lowercase, no Co-Authored-By trailer. Commit locally only, by explicit path. Never push or open a PR.
- Before every commit, `npx vitest run`, `npx tsc --noEmit` and `npm run test:integration` all pass. The last commit of a UI task also passes `npm run lint` (0 errors) and `npm run smoke`.
- Look: indigo `#3B3FA6`, warm greys, IBM Plex, lucide icons, no emoji. Text colours only `text-helplus-{text,text-light,link,danger,success,warning}`, plus `text-white` on primary buttons. Every screen works at 390px.
- Every query goes through the scoped `prisma`. `systemPrisma` is only for looping over companies in the worker.
- Writes use scalar foreign keys, never `connect`. The link check runs outside transactions.
- **Never send, show or store an unmasked image anywhere except the encrypted original.** Only images with status `clean` or `masked` may be shown to viewers or later sent to AI. `needs_check` and `pending` images are held back.
- **Originals** are encrypted at rest, served only to staff, supervisors, admins and owners (not viewer, not client), and every view is written to the audit log.
- Images are normalised before OCR and masking: EXIF-rotated, metadata stripped, PNG. Box coordinates always refer to the normalised image.
- Local databases: ServBay Postgres. Dev db `helpplus`, test db `helpplus_test`, user `helpplus`, password `helpplus_dev_2026`. psql and pg_dump are in `/c/ServBay/packages/postgresql/18/bin/`.
- A dev server runs on :3000. Before `prisma generate` or `next build`, stop it with PowerShell: `Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000 -State Listen).OwningProcess -Force -Confirm:$false`. Restart it with `cd /d/development/helpdeskAI2 && (nohup npm run dev > ../helpdeskAI2-dev.log 2>&1 &)`. If tsc complains about `.next/dev/types`, delete that folder.
- Logins are rate limited to 5 per minute per IP. Puppeteer scripts log in once and reuse the cookie.

---

## Decisions this plan makes

User decisions (2026-10-08):
- Stage 3 is split into three plans: **3A screenshots and IC** (this one), 3B imports, 3C silent bot.
- OCR runs automatically and covers ICs. When it's unsure, the image is marked "needs check".
- Originals are kept 90 days after the ticket closes, and each company can change that.

Plan decisions:
- **File types.** PNG, JPEG and WebP only, at most 10 MB each and 5 per upload. The type is checked with `sharp(...).metadata()`, not by the file name or the browser's content type. Other file types are refused with 415. PDFs and documents come later if needed.
- **When OCR runs.** Inside the upload request, right after upload. If it fails or times out, the row stays `pending` and the worker retries it within a minute (rows pending for 5+ minutes). Staff see "Checking for IC numbers…" meanwhile.
- **How OCR text is matched.**
  - The match leans towards over-masking. Before matching, digit-like characters in mostly-digit words are normalised (`O`/`o`/`D` → 0, `I`/`l`/`|` → 1, `S`/`s` → 5, `B` → 8, `Z` → 2). Separators allowed between groups are space, `-`, `–`, `—`, `.` and `~`.
  - Each box is padded 6 px.
- **When an image is "needs check".** Any of these:
  - overall OCR confidence below 70;
  - any word with 4 or more digits and confidence below 80;
  - OCR threw an error.

  An image with no text at all is `clean`.
- **Masked copies** are stored unencrypted. They contain no IC numbers and are served often. Originals are encrypted.
- **Manual masking.** Staff draw boxes on the ticket page. The server re-applies the automatic boxes plus the manual boxes to the original, so nothing is lost. Confirming a needs-check image without boxes marks it `clean` or `masked`, based on what the OCR found.
- **Who sees what.**
  - Anyone who can see the ticket (viewer and up) sees `clean` and `masked` images.
  - Only staff and up (permission `attachments:original`) see `needs_check` images, view originals, confirm, or draw boxes.
  - Every original view and every check is audit-logged.
- **Retention.** A new setting, `Settings.originalRetentionDays`, defaults to 90, with a minimum of 1 and a maximum of 3650. The worker deletes originals of tickets closed more than that many days ago. The masked copy stays.
- **Deleting tickets.** When a ticket, a conversation or a GDPR delete removes attachment rows, their files are removed from storage first.
- **The inbox** gets a "Screens to check" chip for open tickets with a `needs_check` image. It's visible to staff and up.
- **Not in 3A:** sending images to the AI. Stage 4 reads masked images through `imageForAi()`, which this plan adds and tests. The S3 driver also waits until deployment.

## File map

| File | Status | Job |
|---|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20261009000000_attachments/migration.sql` | modify / new | `Attachment`, `Settings.originalRetentionDays` |
| `src/lib/secrets.ts` | modify | `encryptBuffer`, `decryptBuffer` |
| `src/lib/storage/index.ts`, `src/lib/storage/local.ts` | new | file storage behind one interface |
| `src/lib/privacy/ic-mask.ts` | modify | export the IC pattern source |
| `src/lib/privacy/ic-image.ts` | new | find IC boxes in OCR output, needs-check rule, normalise and cover images |
| `src/lib/ocr/tesseract.ts` | new | OCR adapter |
| `src/lib/attachments/service.ts`, `process.ts`, `files.ts` | new | add, process, AI-safe read, delete files |
| `src/lib/jobs/attachments.ts` | new | retry pending, delete expired originals |
| `src/app/api/tickets/[id]/attachments/route.ts`, `src/app/api/attachments/[id]/**` | new | upload, view, original, check |
| ticket, conversation and GDPR delete paths | modify | remove files first |
| `src/components/tickets/screenshots.tsx`, `mask-editor.tsx`, quick add, ticket page, inbox | new / modify | UI |
| `src/app/(dashboard)/privacy/page.tsx`, nav | new / modify | Privacy & IC settings |
| `src/lib/channels/whatsapp.ts` | modify | incoming images become attachments |

---

### Task 1: Database and encrypted storage

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/tenant/links.ts`, `src/lib/rbac.ts`, `src/lib/secrets.ts`, `src/lib/validations.ts` (`updateSettingsSchema`), `tests/setup.ts`, `tests/unit/rbac.test.ts`, `.gitignore`
- Create: `prisma/migrations/20261009000000_attachments/migration.sql`, `src/lib/storage/index.ts`, `src/lib/storage/local.ts`, `tests/unit/storage.test.ts`, `tests/unit/secrets-buffer.test.ts`, `tests/integration/attachments-schema.test.ts`

**Interfaces:**
- Produces:
  - Prisma model `Attachment { id, companyId, ticketId, messageId?, fileName, status, originalKey?, maskedKey?, width, height, icCount, ocrConfidence?, autoBoxes Json, manualBoxes Json, checkNote, checkedById?, checkedAt?, originalDeletedAt?, createdAt, updatedAt }`
  - `Settings.originalRetentionDays` (default 90)
  - permission `"attachments:original"` for staff, supervisor, admin and owner
  - `encryptBuffer(data: Buffer): Buffer` and `decryptBuffer(data: Buffer): Buffer`
  - `interface FileStore { put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer>; remove(key: string): Promise<void> }`, `fileStore(): FileStore`, `attachmentKey(companyId: string, id: string, kind: "original" | "masked"): string`

- [ ] **Step 1: Schema**

In `prisma/schema.prisma`:

Add `attachments Attachment[]` to `model Company`, `model Ticket`, `model Message` and `model Admin`. On `Admin`, name the relation `@relation("AttachmentCheckedBy")` on both sides.

Add `originalRetentionDays Int @default(90)` to `model Settings`.

New model:

```prisma
model Attachment {
  id                String    @id @default(uuid())
  companyId         String    @default("")
  company           Company   @relation(fields: [companyId], references: [id], onDelete: Cascade)
  ticketId          String
  ticket            Ticket    @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  messageId         String?
  message           Message?  @relation(fields: [messageId], references: [id], onDelete: SetNull)
  fileName          String    @default("screenshot.png")
  status            String    @default("pending") // pending, clean, masked, needs_check
  originalKey       String?
  maskedKey         String?
  width             Int       @default(0)
  height            Int       @default(0)
  icCount           Int       @default(0)
  ocrConfidence     Int?
  autoBoxes         Json      @default("[]")
  manualBoxes       Json      @default("[]")
  checkNote         String    @default("")
  checkedById       String?
  checkedBy         Admin?    @relation("AttachmentCheckedBy", fields: [checkedById], references: [id], onDelete: SetNull)
  checkedAt         DateTime?
  originalDeletedAt DateTime?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([companyId, status])
  @@index([ticketId])
  @@index([messageId])
}
```

Run: `npx prisma validate`. Expected: valid.

- [ ] **Step 2: Migration**

Create `prisma/migrations/20261009000000_attachments/migration.sql`:

```sql
ALTER TABLE "Settings" ADD COLUMN "originalRetentionDays" INTEGER NOT NULL DEFAULT 90;

CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "ticketId" TEXT NOT NULL,
    "messageId" TEXT,
    "fileName" TEXT NOT NULL DEFAULT 'screenshot.png',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "originalKey" TEXT,
    "maskedKey" TEXT,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "icCount" INTEGER NOT NULL DEFAULT 0,
    "ocrConfidence" INTEGER,
    "autoBoxes" JSONB NOT NULL DEFAULT '[]',
    "manualBoxes" JSONB NOT NULL DEFAULT '[]',
    "checkNote" TEXT NOT NULL DEFAULT '',
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3),
    "originalDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Attachment_companyId_status_idx" ON "Attachment"("companyId", "status");
CREATE INDEX "Attachment_ticketId_idx" ON "Attachment"("ticketId");
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Back up the dev db and apply the migration to it:

```bash
PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/pg_dump.exe -h localhost -U helpplus -d helpplus -Fc -f .superpowers/backup/helpplus-before-3a.dump
PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/psql.exe -h localhost -U helpplus -d helpplus -v ON_ERROR_STOP=1 -f prisma/migrations/20261009000000_attachments/migration.sql
npx prisma db push && npx prisma generate
DATABASE_URL="postgresql://helpplus:helpplus_dev_2026@localhost:5432/helpplus_test?schema=public" npx prisma migrate deploy
```

Expected:
- psql reports no `ERROR`.
- `db push` says the database is already in sync. If it wants anything else, stop and report.
- `migrate deploy` applies 1 migration.

Stop the dev server before `generate` and restart it afterwards.

- [ ] **Step 3: Links, permission, settings validation, test mocks**

`src/lib/tenant/links.ts`:
- Add `Attachment: { ticketId: "Ticket", messageId: "Message", checkedById: "Admin" }` to `LINKS`.
- Add the matching `RELATIONS`: `Attachment.ticket`, `Attachment.message`, `Attachment.checkedBy`, `Ticket.attachments`, `Message.attachments` and `Admin.attachments`.
- Follow what `tests/unit/tenant-links.test.ts` reports. Don't edit that test.

`src/lib/rbac.ts`: add before `"company:manage"`:

```ts
  // Screenshot originals and IC checks
  "attachments:original": ["staff", "supervisor", "admin", "owner"],
```

`tests/unit/rbac.test.ts`:

```ts
  it("viewers never see screenshot originals", () => {
    expect(hasPermission("viewer", "attachments:original")).toBe(false);
    expect(hasPermission("staff", "attachments:original")).toBe(true);
  });
```

`src/lib/validations.ts`: in `updateSettingsSchema`, add `originalRetentionDays: z.number().int().min(1).max(3650).optional(),`.

`tests/setup.ts`: add `"attachment"` to the mocked models.

`.gitignore`: add `/storage/` and `/.cache/`.

- [ ] **Step 4: Encrypted buffers, test first**

Create `tests/unit/secrets-buffer.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { encryptBuffer, decryptBuffer } from "@/lib/secrets";

beforeAll(() => {
  process.env.HELPLUS_SECRET_KEY = "a".repeat(64);
});

describe("buffer encryption", () => {
  it("round trips and hides the bytes", () => {
    const data = Buffer.from("IC 900101-14-5678 in a screenshot");
    const enc = encryptBuffer(data);
    expect(enc.includes(Buffer.from("900101"))).toBe(false);
    expect(decryptBuffer(enc).equals(data)).toBe(true);
  });

  it("uses a fresh iv every time", () => {
    const data = Buffer.from("same");
    expect(encryptBuffer(data).equals(encryptBuffer(data))).toBe(false);
  });

  it("refuses tampered data", () => {
    const enc = encryptBuffer(Buffer.from("hello"));
    enc[enc.length - 1] ^= 1;
    expect(() => decryptBuffer(enc)).toThrow();
  });

  it("refuses data that isn't ours", () => {
    expect(() => decryptBuffer(Buffer.from("plain bytes"))).toThrow("not an encrypted file");
  });
});
```

If `tests/setup.ts` already sets `HELPLUS_SECRET_KEY`, drop the `beforeAll`.

Add to `src/lib/secrets.ts`:

```ts
const FILE_MAGIC = Buffer.from("HPE1");

export function encryptBuffer(data: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([FILE_MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decryptBuffer(data: Buffer): Buffer {
  if (data.length < 32 || !data.subarray(0, 4).equals(FILE_MAGIC)) throw new Error("not an encrypted file");
  const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(4, 16));
  decipher.setAuthTag(data.subarray(16, 32));
  return Buffer.concat([decipher.update(data.subarray(32)), decipher.final()]);
}
```

Run: `npx vitest run tests/unit/secrets-buffer.test.ts`. Expected: PASS (4).

- [ ] **Step 5: File storage, test first**

Create `tests/unit/storage.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileStore, attachmentKey } from "@/lib/storage";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "helplus-store-"));
  process.env.HELPLUS_STORAGE_DIR = dir;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.HELPLUS_STORAGE_DIR;
});

describe("local file store", () => {
  it("puts, gets and removes", async () => {
    const store = fileStore();
    const key = attachmentKey("co-1", "att-1", "masked");
    await store.put(key, Buffer.from("png bytes"));
    expect((await store.get(key)).toString()).toBe("png bytes");
    await store.remove(key);
    await expect(store.get(key)).rejects.toThrow();
  });

  it("removing a missing file is fine", async () => {
    await expect(fileStore().remove(attachmentKey("co-1", "nope", "original"))).resolves.toBeUndefined();
  });

  it("refuses keys that escape the folder", async () => {
    await expect(fileStore().put("../evil", Buffer.from("x"))).rejects.toThrow("bad storage key");
    await expect(fileStore().get("c/../../etc/passwd")).rejects.toThrow("bad storage key");
  });

  it("keys are per company", () => {
    expect(attachmentKey("co-1", "att-1", "original")).toBe("c/co-1/attachments/att-1/original.bin");
    expect(attachmentKey("co-1", "att-1", "masked")).toBe("c/co-1/attachments/att-1/masked.png");
  });
});
```

Create `src/lib/storage/local.ts`:

```ts
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import type { FileStore } from "./index";

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

export function localStore(root: string): FileStore {
  const full = (key: string) => {
    if (!SAFE_KEY.test(key) || key.split("/").includes("..")) throw new Error("bad storage key");
    return path.join(root, ...key.split("/"));
  };
  return {
    async put(key, data) {
      const file = full(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    },
    async get(key) {
      return readFile(full(key));
    },
    async remove(key) {
      await rm(full(key), { force: true });
    },
  };
}
```

Create `src/lib/storage/index.ts`:

```ts
import path from "path";
import { localStore } from "./local";

export interface FileStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

// local disk for now, an s3/minio store comes with deployment
export function fileStore(): FileStore {
  return localStore(process.env.HELPLUS_STORAGE_DIR || path.join(process.cwd(), "storage"));
}

export function attachmentKey(companyId: string, id: string, kind: "original" | "masked"): string {
  return `c/${companyId}/attachments/${id}/${kind === "original" ? "original.bin" : "masked.png"}`;
}
```

Run: `npx vitest run tests/unit/storage.test.ts`. Expected: PASS (4).

- [ ] **Step 6: Integration test for the schema**

Create `tests/integration/attachments-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { CrossCompanyLinkError } from "@/lib/tenant/links";
import { createTicket } from "@/lib/tickets/service";

const A = "it-3a-schema-a";
const B = "it-3a-schema-b";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({ data: [{ id: A, name: "A", slug: A }, { id: B, name: "B", slug: B }] });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("attachments schema", () => {
  it("can't attach to another company's ticket", async () => {
    const t = await runWithCompany(A, () => createTicket({ text: "x" }));
    await expect(runWithCompany(B, () => prisma.attachment.create({ data: { ticketId: t.id } }))).rejects.toThrow(
      CrossCompanyLinkError
    );
  });

  it("goes away with its ticket and keeps 90 days by default", async () => {
    const t = await runWithCompany(A, () => createTicket({ text: "y" }));
    const a = await runWithCompany(A, () => prisma.attachment.create({ data: { ticketId: t.id } }));
    expect(a.status).toBe("pending");
    await runWithCompany(A, () => prisma.ticket.delete({ where: { id: t.id } }));
    expect(await runWithCompany(A, () => prisma.attachment.findUnique({ where: { id: a.id } }))).toBeNull();
    const s = await runWithCompany(A, () => prisma.settings.create({ data: {} }));
    expect(s.originalRetentionDays).toBe(90);
  });
});
```

Run: `npm run test:integration`. Expected: all pass.

- [ ] **Step 7: Commit**

Run `npx tsc --noEmit`, `npx vitest run` and `npm run test:integration`; all must pass.

```bash
git add prisma src/lib/tenant/links.ts src/lib/rbac.ts src/lib/secrets.ts src/lib/validations.ts src/lib/storage tests/setup.ts tests/unit/rbac.test.ts tests/unit/secrets-buffer.test.ts tests/unit/storage.test.ts tests/integration/attachments-schema.test.ts .gitignore
git commit -m "attachments table, encrypted file storage"
```

---

### Task 2: Find and cover IC numbers in images

**Files:**
- Modify: `src/lib/privacy/ic-mask.ts` (export the pattern source)
- Create: `src/lib/privacy/ic-image.ts`, `tests/unit/ic-image.test.ts`

**Interfaces:**
- Produces:
  - `interface OcrWord { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }`
  - `interface OcrLine { words: OcrWord[] }`
  - `interface OcrResult { confidence: number; lines: OcrLine[] }`
  - `interface Box { x: number; y: number; w: number; h: number }`
  - `IC_REGEX_SOURCE: string` (exported from ic-mask.ts)
  - `findIcBoxes(lines: OcrLine[], pad?: number): Box[]`
  - `needsCheck(result: OcrResult): boolean`
  - `normalizeImage(data: Buffer): Promise<{ png: Buffer; width: number; height: number }>`
  - `coverBoxes(png: Buffer, boxes: Box[]): Promise<Buffer>`
  - `isAllowedImage(data: Buffer): Promise<boolean>`

- [ ] **Step 1: Test first**

Create `tests/unit/ic-image.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { findIcBoxes, needsCheck, normalizeImage, coverBoxes, isAllowedImage, type OcrLine } from "@/lib/privacy/ic-image";

let x = 0;
const word = (text: string, confidence = 95, width = 60) => {
  const w = { text, confidence, bbox: { x0: x, y0: 10, x1: x + width, y1: 30 } };
  x += width + 10;
  return w;
};
const line = (...texts: string[]): OcrLine => {
  x = 0;
  return { words: texts.map((t) => word(t)) };
};

describe("findIcBoxes", () => {
  it("finds an IC written as one word", () => {
    const boxes = findIcBoxes([line("IC:", "900101-14-5678", "thanks")]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toEqual({ x: 70 - 6, y: 10 - 6, w: 60 + 12, h: 20 + 12 });
  });

  it("joins an IC split over three words", () => {
    const boxes = findIcBoxes([line("no", "900101", "14", "5678")]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].x).toBe(70 - 6);
    expect(boxes[0].w).toBe(3 * 60 + 2 * 10 + 12);
  });

  it("reads common OCR mix-ups as digits", () => {
    expect(findIcBoxes([line("9OO1O1-l4-S678")])).toHaveLength(1);
    expect(findIcBoxes([line("900101—14—5678")])).toHaveLength(1);
  });

  it("leaves ordinary words and short numbers alone", () => {
    expect(findIcBoxes([line("Invoice", "12345", "SOLD", "Bill")])).toHaveLength(0);
    expect(findIcBoxes([line("ref", "12345678901234")])).toHaveLength(0);
  });

  it("finds several ICs on several lines", () => {
    expect(findIcBoxes([line("900101145678"), line("a", "850505-10-1234")])).toHaveLength(2);
  });
});

describe("needsCheck", () => {
  const ok = { confidence: 90, lines: [line("hello", "900101-14-5678")] };
  it("passes a clear image", () => {
    expect(needsCheck(ok)).toBe(false);
  });
  it("flags low overall confidence", () => {
    expect(needsCheck({ ...ok, confidence: 60 })).toBe(true);
  });
  it("flags an unsure number", () => {
    x = 0;
    expect(needsCheck({ confidence: 90, lines: [{ words: [word("90010114", 70)] }] })).toBe(true);
  });
  it("an image with no text is fine", () => {
    expect(needsCheck({ confidence: 0, lines: [] })).toBe(false);
  });
});

describe("images", () => {
  const red = () => sharp({ create: { width: 100, height: 50, channels: 3, background: "#ff0000" } }).jpeg().toBuffer();

  it("normalises to png and reports the size", async () => {
    const n = await normalizeImage(await red());
    expect((await sharp(n.png).metadata()).format).toBe("png");
    expect([n.width, n.height]).toEqual([100, 50]);
  });

  it("covers a box in black", async () => {
    const { png } = await normalizeImage(await red());
    const out = await coverBoxes(png, [{ x: 10, y: 10, w: 20, h: 10 }]);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const at = (px: number, py: number) => Array.from(data.subarray((py * info.width + px) * info.channels, (py * info.width + px) * info.channels + 3));
    expect(at(15, 15)).toEqual([0, 0, 0]);
    expect(at(50, 30)).toEqual([255, 0, 0]);
  });

  it("clips boxes to the image", async () => {
    const { png } = await normalizeImage(await red());
    await expect(coverBoxes(png, [{ x: 90, y: 40, w: 50, h: 50 }])).resolves.toBeInstanceOf(Buffer);
  });

  it("only allows png, jpeg and webp", async () => {
    expect(await isAllowedImage(await red())).toBe(true);
    expect(await isAllowedImage(Buffer.from("%PDF-1.4 not an image"))).toBe(false);
    const gif = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).gif().toBuffer();
    expect(await isAllowedImage(gif)).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/ic-image.test.ts`. Expected: FAIL, the module is not found.

- [ ] **Step 2: Export the pattern**

In `src/lib/privacy/ic-mask.ts`:
- Add `export const IC_REGEX_SOURCE = String.raw\`(?<!\d)\d{6}[\s-]?\d{2}[\s-]?\d{4}(?!\d)\`;`.
- Make `IC_PATTERN` `new RegExp(IC_REGEX_SOURCE, "g")`.

Run the existing ic-mask tests to confirm nothing changed.

- [ ] **Step 3: Implementation**

Create `src/lib/privacy/ic-image.ts`:

```ts
import sharp from "sharp";

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
export interface OcrLine {
  words: OcrWord[];
}
export interface OcrResult {
  confidence: number;
  lines: OcrLine[];
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_PAGE_CONFIDENCE = 70;
export const MIN_NUMBER_CONFIDENCE = 80;
const PAD = 6;
const ALLOWED = new Set(["png", "jpeg", "webp"]);

// ocr separators are messier than typed text, so allow dashes and dots between groups
const IMAGE_IC = /(?<!\d)\d{6}[\s\-–—.~]?\d{2}[\s\-–—.~]?\d{4}(?!\d)/g;
const LOOKALIKE: Record<string, string> = { O: "0", o: "0", D: "0", I: "1", l: "1", "|": "1", S: "5", s: "5", B: "8", Z: "2" };

const digits = (t: string) => (t.match(/\d/g) ?? []).length;

// only fix lookalikes in words that are mostly digits, so real words stay words
function asDigits(text: string): string {
  const fixed = [...text].map((c) => LOOKALIKE[c] ?? c).join("");
  return digits(fixed) >= Math.ceil(text.replace(/[\s\-–—.~]/g, "").length * 0.7) ? fixed : text;
}

export function findIcBoxes(lines: OcrLine[], pad = PAD): Box[] {
  const boxes: Box[] = [];
  for (const line of lines) {
    let text = "";
    const spans: { start: number; end: number; word: OcrWord }[] = [];
    for (const w of line.words) {
      if (text) text += " ";
      const start = text.length;
      text += asDigits(w.text);
      spans.push({ start, end: text.length, word: w });
    }
    for (const m of text.matchAll(IMAGE_IC)) {
      const from = m.index ?? 0;
      const to = from + m[0].length;
      const hit = spans.filter((s) => s.start < to && s.end > from).map((s) => s.word.bbox);
      if (!hit.length) continue;
      const x0 = Math.min(...hit.map((b) => b.x0));
      const y0 = Math.min(...hit.map((b) => b.y0));
      const x1 = Math.max(...hit.map((b) => b.x1));
      const y1 = Math.max(...hit.map((b) => b.y1));
      boxes.push({ x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad });
    }
  }
  return boxes;
}

export function needsCheck(result: OcrResult): boolean {
  const words = result.lines.flatMap((l) => l.words);
  if (!words.length) return false;
  if (result.confidence < MIN_PAGE_CONFIDENCE) return true;
  return words.some((w) => digits(w.text) >= 4 && w.confidence < MIN_NUMBER_CONFIDENCE);
}

// rotate by exif, drop metadata, png so box coordinates always match
export async function normalizeImage(data: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  const { data: png, info } = await sharp(data).rotate().png().toBuffer({ resolveWithObject: true });
  return { png, width: info.width, height: info.height };
}

export async function coverBoxes(png: Buffer, boxes: Box[]): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(png).metadata();
  const layers = boxes
    .map((b) => {
      const left = Math.max(0, Math.floor(b.x));
      const top = Math.max(0, Math.floor(b.y));
      const w = Math.min(width - left, Math.ceil(b.x + b.w) - left);
      const h = Math.min(height - top, Math.ceil(b.y + b.h) - top);
      return { left, top, w, h };
    })
    .filter((b) => b.w > 0 && b.h > 0)
    .map((b) => ({
      input: { create: { width: b.w, height: b.h, channels: 3 as const, background: "#000000" } },
      left: b.left,
      top: b.top,
    }));
  if (!layers.length) return png;
  return sharp(png).composite(layers).png().toBuffer();
}

export async function isAllowedImage(data: Buffer): Promise<boolean> {
  try {
    const { format } = await sharp(data).metadata();
    return !!format && ALLOWED.has(format);
  } catch {
    return false;
  }
}
```

`IMAGE_IC` is kept as a separate, wider pattern on purpose, because OCR separators differ from typed text. `IC_REGEX_SOURCE` is exported for later stages that match typed text.

Run the test. Expected: PASS. If the black pixel check reads 4 channels, compare only the first 3; the helper already slices 3.

- [ ] **Step 4: Commit**

Run `npx tsc --noEmit` and `npx vitest run`.

```bash
git add src/lib/privacy tests/unit/ic-image.test.ts
git commit -m "find and cover ic numbers in images"
```

---

### Task 3: OCR, processing and background jobs

**Files:**
- Create: `src/lib/ocr/tesseract.ts`, `src/lib/attachments/service.ts`, `src/lib/attachments/process.ts`, `src/lib/attachments/files.ts`, `src/lib/jobs/attachments.ts`, `tests/integration/attachments-process.test.ts`, `tests/unit/attachments-files.test.ts`
- Modify: `src/lib/jobs/run.ts` (add the two jobs), `next.config.ts` (server externals), `package.json` (add `tesseract.js`)

**Interfaces:**
- Consumes: Task 1 (`fileStore`, `attachmentKey`, `encryptBuffer`, `decryptBuffer`, `Attachment`) and Task 2 (every function in `ic-image.ts`).
- Produces:
  - `ocrImage(png: Buffer): Promise<OcrResult>` and `closeOcr(): Promise<void>`
  - `addAttachment(input: { ticketId: string; messageId?: string | null; fileName: string; data: Buffer }): Promise<Attachment>`. It stores the encrypted original, creates the row as `pending` and runs `processAttachment`.
  - `processAttachment(id: string): Promise<Attachment | null>`
  - `remask(id: string, manualBoxes: Box[], actor: { id: string; name: string }): Promise<Attachment>`
  - `confirmAttachment(id: string, actor: { id: string; name: string }): Promise<Attachment>`
  - `imageForAi(id: string): Promise<Buffer | null>`. It returns the masked image only when the status is `clean` or `masked`.
  - `removeAttachmentFiles(where: Record<string, unknown>): Promise<number>`
  - `runPendingAttachments(now: Date)` and `runOriginalRetention(now: Date)`

- [ ] **Step 1: Install and check the OCR library**

```bash
npm install tesseract.js@^7
```

Before writing the adapter, read the installed API: `node_modules/tesseract.js/README.md` and its TypeScript types (`node_modules/tesseract.js/src/index.d.ts`, or wherever its `types` field points). Confirm three things:
1. How to create a worker for English, and how to set where it caches language data. Use a cache folder `.cache/tesseract` under the project.
2. How `recognize()` returns words with `text`, `confidence` and `bbox` (`x0`, `y0`, `x1`, `y1`), grouped by line, plus an overall confidence. In recent versions the word-level output may have to be requested explicitly, for example through an output option for blocks.
3. How to terminate the worker.

Write what you find in the report. Use the real names from the installed version, not names from memory.

Check how Next 16 marks packages as server externals. Read `node_modules/next/dist/docs/`, as AGENTS.md asks. Add `tesseract.js` and `sharp` to that list in `next.config.ts`, so the OCR worker script and sharp's binaries load from `node_modules` instead of the bundle.

- [ ] **Step 2: OCR adapter**

Create `src/lib/ocr/tesseract.ts`. It exposes `ocrImage(png)` and `closeOcr()`:
- Reuse one worker per process through a module-level promise. Creating a worker is slow.
- Language: `eng`. Cache: `path.join(process.cwd(), ".cache", "tesseract")`.
- Map the library output to `OcrResult`: lines of words, each with `text`, `confidence` (0-100) and `bbox { x0, y0, x1, y1 }`, plus the page confidence.
- Time out after 30 seconds and throw `new Error("ocr timed out")`. If the worker failed, reset the module promise so the next call creates a new one.

Shape:

```ts
import path from "path";
import type { OcrResult } from "@/lib/privacy/ic-image";

let workerPromise: Promise<unknown> | null = null;
const TIMEOUT_MS = 30_000;

async function getWorker() {
  // create the english worker with cachePath .cache/tesseract, using the installed api
}

export async function ocrImage(png: Buffer): Promise<OcrResult> {
  // recognize with word output, map to OcrResult, race against TIMEOUT_MS
}

export async function closeOcr(): Promise<void> {
  // terminate the worker if one was started, then reset workerPromise
}
```

Fill in the three bodies from what Step 1 found. Keep the file under about 80 lines, and keep comments to one short line each.

- [ ] **Step 3: Service and processing**

Create `src/lib/attachments/service.ts`:

```ts
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { currentCompanyId } from "@/lib/tenant/context";
import { encryptBuffer } from "@/lib/secrets";
import { attachmentKey, fileStore } from "@/lib/storage";
import { processAttachment } from "./process";

export const MAX_BYTES = 10 * 1024 * 1024;

// the original is written before the row so a row never points at nothing
export async function addAttachment(input: { ticketId: string; messageId?: string | null; fileName: string; data: Buffer }) {
  const id = randomUUID();
  const originalKey = attachmentKey(currentCompanyId(), id, "original");
  const store = fileStore();
  await store.put(originalKey, encryptBuffer(input.data));
  try {
    await prisma.attachment.create({
      data: {
        id,
        ticketId: input.ticketId,
        messageId: input.messageId ?? null,
        fileName: input.fileName.slice(0, 200) || "screenshot.png",
        originalKey,
      },
    });
  } catch (error) {
    await store.remove(originalKey);
    throw error;
  }
  return (await processAttachment(id))!;
}
```

Create `src/lib/attachments/process.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { logActivity } from "@/lib/activity";
import { currentCompanyId } from "@/lib/tenant/context";
import { decryptBuffer } from "@/lib/secrets";
import { attachmentKey, fileStore } from "@/lib/storage";
import { ocrImage } from "@/lib/ocr/tesseract";
import { coverBoxes, findIcBoxes, needsCheck, normalizeImage, type Box } from "@/lib/privacy/ic-image";

async function originalPng(originalKey: string) {
  return normalizeImage(decryptBuffer(await fileStore().get(originalKey)));
}

async function saveMasked(id: string, png: Buffer, boxes: Box[]): Promise<string> {
  const key = attachmentKey(currentCompanyId(), id, "masked");
  await fileStore().put(key, await coverBoxes(png, boxes));
  return key;
}

export async function processAttachment(id: string) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a || a.status !== "pending" || !a.originalKey) return a;
  const { png, width, height } = await originalPng(a.originalKey);
  try {
    const result = await ocrImage(png);
    const boxes = findIcBoxes(result.lines);
    const status = needsCheck(result) ? "needs_check" : boxes.length ? "masked" : "clean";
    return prisma.attachment.update({
      where: { id },
      data: {
        status,
        width,
        height,
        icCount: boxes.length,
        ocrConfidence: Math.round(result.confidence),
        autoBoxes: boxes as unknown as object,
        maskedKey: await saveMasked(id, png, boxes),
        checkNote: status === "needs_check" ? "OCR wasn't sure. Check for IC numbers." : "",
      },
    });
  } catch (error) {
    logger.error("ocr failed", error);
    return prisma.attachment.update({
      where: { id },
      data: { status: "needs_check", width, height, maskedKey: await saveMasked(id, png, []), checkNote: "OCR couldn't read this image." },
    });
  }
}

async function load(id: string) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a) throw new Error("attachment not found");
  if (!a.originalKey) throw new Error("the original was deleted");
  return { ...a, originalKey: a.originalKey };
}

// auto boxes stay, manual boxes go on top, always from the original
export async function remask(id: string, manualBoxes: Box[], actor: { id: string; name: string }) {
  const a = await load(id);
  const auto = (a.autoBoxes as unknown as Box[]) ?? [];
  const manual = [...((a.manualBoxes as unknown as Box[]) ?? []), ...manualBoxes];
  const { png } = await originalPng(a.originalKey);
  const updated = await prisma.attachment.update({
    where: { id },
    data: {
      status: "masked",
      manualBoxes: manual as unknown as object,
      icCount: auto.length + manual.length,
      maskedKey: await saveMasked(id, png, [...auto, ...manual]),
      checkedById: actor.id,
      checkedAt: new Date(),
      checkNote: "",
    },
  });
  await logActivity("attachment.masked", "attachment", id, `Covered ${manualBoxes.length} area(s) on a screenshot`, actor.name);
  return updated;
}

export async function confirmAttachment(id: string, actor: { id: string; name: string }) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a) throw new Error("attachment not found");
  const updated = await prisma.attachment.update({
    where: { id },
    data: { status: a.icCount > 0 ? "masked" : "clean", checkedById: actor.id, checkedAt: new Date(), checkNote: "" },
  });
  await logActivity("attachment.checked", "attachment", id, "Confirmed a screenshot has no visible IC", actor.name);
  return updated;
}
```

The `actor.id` for an API-key user starts with `api-key:`. Pass `null` as `checkedById` in that case: `checkedById: actor.id.startsWith("api-key:") ? null : actor.id`. Apply that in both places.

Create `src/lib/attachments/files.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { fileStore } from "@/lib/storage";

const SHOWABLE = new Set(["clean", "masked"]);

// the ai only ever gets a masked copy that staff can trust
export async function imageForAi(id: string): Promise<Buffer | null> {
  const a = await prisma.attachment.findUnique({ where: { id }, select: { status: true, maskedKey: true } });
  if (!a || !SHOWABLE.has(a.status) || !a.maskedKey) return null;
  return fileStore().get(a.maskedKey);
}

// call before deleting rows, the database cascade can't reach the disk
export async function removeAttachmentFiles(where: Record<string, unknown>): Promise<number> {
  const rows = await prisma.attachment.findMany({ where, select: { originalKey: true, maskedKey: true } });
  const store = fileStore();
  for (const r of rows) {
    for (const key of [r.originalKey, r.maskedKey]) {
      if (!key) continue;
      try {
        await store.remove(key);
      } catch (error) {
        logger.error("couldn't remove attachment file", error);
      }
    }
  }
  return rows.length;
}
```

Create `tests/unit/attachments-files.test.ts`, with mocked Prisma and a temp `HELPLUS_STORAGE_DIR`, covering:
- `imageForAi` returns null for `pending` and `needs_check`, and the bytes for `clean` and `masked`;
- `removeAttachmentFiles` removes both keys and skips null ones.

- [ ] **Step 4: Jobs**

Create `src/lib/jobs/attachments.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { logger } from "@/lib/logger";
import { fileStore } from "@/lib/storage";
import { processAttachment } from "@/lib/attachments/process";

const DAY = 86_400_000;
const STALE_PENDING_MS = 5 * 60_000;
const BATCH = 20;

// uploads normally finish inside the request, this picks up the ones that didn't
export async function runPendingAttachments(now: Date): Promise<number> {
  const rows = await prisma.attachment.findMany({
    where: { status: "pending", createdAt: { lte: new Date(now.getTime() - STALE_PENDING_MS) } },
    select: { id: true },
    take: BATCH,
  });
  for (const r of rows) {
    try {
      await processAttachment(r.id);
    } catch (error) {
      logger.error("retrying attachment failed", error);
    }
  }
  return rows.length;
}

export async function runOriginalRetention(now: Date): Promise<number> {
  const days = (await getSettings()).originalRetentionDays;
  const rows = await prisma.attachment.findMany({
    where: {
      originalKey: { not: null },
      ticket: { status: "closed", closedAt: { lte: new Date(now.getTime() - days * DAY) } },
    },
    select: { id: true, originalKey: true },
    take: 200,
  });
  for (const r of rows) {
    try {
      await fileStore().remove(r.originalKey!);
      await prisma.attachment.update({ where: { id: r.id }, data: { originalKey: null, originalDeletedAt: now } });
    } catch (error) {
      logger.error("couldn't delete an expired original", error);
    }
  }
  return rows.length;
}
```

In `src/lib/jobs/run.ts`, add `["attachments", runPendingAttachments]` and `["original retention", runOriginalRetention]` to `JOBS`.

- [ ] **Step 5: Integration test with a real image**

Create `tests/integration/attachments-process.test.ts`. It builds a test image with `sharp` from an SVG, runs the real OCR, and checks the outcome:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { createTicket } from "@/lib/tickets/service";
import { addAttachment } from "@/lib/attachments/service";
import { remask, confirmAttachment } from "@/lib/attachments/process";
import { imageForAi } from "@/lib/attachments/files";
import { runOriginalRetention } from "@/lib/jobs/attachments";
import { closeOcr } from "@/lib/ocr/tesseract";

const A = "it-3a-ocr";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);
let dir: string;

const textImage = (text: string) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="160"><rect width="100%" height="100%" fill="white"/><text x="20" y="100" font-family="Arial" font-size="48" fill="black">${text}</text></svg>`
    )
  )
    .png()
    .toBuffer();

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "helplus-ocr-"));
  process.env.HELPLUS_STORAGE_DIR = dir;
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "A", slug: A } });
});

afterAll(async () => {
  await closeOcr();
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("screenshot processing", { timeout: 120_000 }, () => {
  it("covers an IC and keeps the original encrypted", async () => {
    const t = await asA(() => createTicket({ text: "login issue" }));
    const a = await asA(async () => addAttachment({ ticketId: t.id, fileName: "s.png", data: await textImage("My IC 900101-14-5678 thanks") }));
    expect(["masked", "needs_check"]).toContain(a.status);
    if (a.status === "masked") {
      expect(a.icCount).toBe(1);
      expect(await asA(() => imageForAi(a.id))).toBeInstanceOf(Buffer);
    }
    const raw = await import("fs/promises").then((f) => f.readFile(path.join(dir, ...a.originalKey!.split("/"))));
    expect(raw.subarray(0, 4).toString()).toBe("HPE1");
  });

  it("marks a clean image clean", async () => {
    const t = await asA(() => createTicket({ text: "x" }));
    const a = await asA(async () => addAttachment({ ticketId: t.id, fileName: "c.png", data: await textImage("Report page is empty") }));
    expect(a.status).toBe("clean");
    expect(a.icCount).toBe(0);
  });

  it("staff can cover more and confirm", async () => {
    const t = await asA(() => createTicket({ text: "x" }));
    const a = await asA(async () => addAttachment({ ticketId: t.id, fileName: "m.png", data: await textImage("Name Ali") }));
    const masked = await asA(() => remask(a.id, [{ x: 10, y: 10, w: 100, h: 40 }], { id: "api-key:x", name: "Tester" }));
    expect(masked.status).toBe("masked");
    expect(masked.icCount).toBe(1);
    const confirmed = await asA(() => confirmAttachment(a.id, { id: "api-key:x", name: "Tester" }));
    expect(confirmed.status).toBe("masked");
  });

  it("deletes originals after the retention days", async () => {
    const t = await asA(() => createTicket({ text: "x" }));
    const a = await asA(async () => addAttachment({ ticketId: t.id, fileName: "r.png", data: await textImage("old") }));
    await asA(() => prisma.ticket.update({ where: { id: t.id }, data: { status: "closed", closedAt: new Date(Date.now() - 100 * 86_400_000) } }));
    await asA(() => runOriginalRetention(new Date()));
    const after = await asA(() => prisma.attachment.findUniqueOrThrow({ where: { id: a.id } }));
    expect(after.originalKey).toBeNull();
    expect(after.originalDeletedAt).not.toBeNull();
    expect(after.maskedKey).not.toBeNull();
  });
});
```

The first run downloads English language data, about 10 MB, into `.cache/tesseract`. Expect it to take longer.

If the first test lands on `needs_check` because the synthetic image reads poorly, that's an allowed outcome. It's the safe fallback. Report which it was. The second test must be `clean`; if it isn't, check the needs-check thresholds against the real confidences and report them.

Run: `npm run test:integration`. Expected: all pass.

- [ ] **Step 6: Commit**

Run `npx tsc --noEmit`, `npx vitest run` and `npm run test:integration`. Then `npm run worker -- --once`, which must exit 0.

```bash
git add package.json package-lock.json next.config.ts src/lib/ocr src/lib/attachments src/lib/jobs tests/integration/attachments-process.test.ts tests/unit/attachments-files.test.ts
git commit -m "ocr screenshots, cover ic numbers, keep originals encrypted"
```

---

### Task 4: Screenshot API and safe deletes

**Files:**
- Create: `src/app/api/tickets/[id]/attachments/route.ts`, `src/app/api/attachments/[id]/route.ts`, `src/app/api/attachments/[id]/original/route.ts`, `src/app/api/attachments/[id]/check/route.ts`, `tests/api/attachments.test.ts`
- Modify:
  - `src/app/api/tickets/[id]/route.ts`: GET includes attachments, DELETE removes files first
  - `src/app/api/tickets/route.ts`: `attention=screens` filter and `screensToCheck` count
  - `src/app/api/conversations/[id]/route.ts`: DELETE removes files first
  - `src/lib/gdpr.ts`: delete and anonymize remove files and attachment rows
  - `tests/api/tickets.test.ts`

**Interfaces:**
- Consumes: Task 3 (`addAttachment`, `remask`, `confirmAttachment`, `removeAttachmentFiles`, `MAX_BYTES`), `isAllowedImage`, `loadTicketFor`, `hasPermission`.
- Produces (HTTP):
  - `POST /api/tickets/:id/attachments`: multipart with field `files` (1 to 5 images). Returns `{ data: AttachmentRow[] }` with status 201.
  - `GET /api/attachments/:id`: the masked PNG. `pending` returns 202 `{ status }`. `needs_check` requires `attachments:original`, otherwise 403.
  - `GET /api/attachments/:id/original`: the decrypted original. Needs `attachments:original`, writes an audit entry, and returns 410 once deleted.
  - `POST /api/attachments/:id/check`: body `{ action: "confirm" }` or `{ action: "mask", boxes: Box[] }`. Needs `attachments:original`.
  - `GET /api/tickets/:id` includes `attachments: AttachmentRow[]`.
  - `GET /api/tickets?attention=screens` returns open tickets with a needs-check image. The response gains `screensToCheck: number`, which is 0 for users without `attachments:original`.
  - `AttachmentRow = { id, messageId, fileName, status, icCount, width, height, checkNote, originalDeletedAt, createdAt }`

- [ ] **Step 1: API tests first**

Create `tests/api/attachments.test.ts`. Use the `asRole` and `createRequest` helpers from the 2B tests. Mock `@/lib/attachments/service`, `@/lib/attachments/process`, `@/lib/storage` and `@/lib/secrets` where a test needs bytes. Cover these cases:
- Upload:
  - asks for `"tickets:update"`;
  - returns 404 for a ticket the user can't see (`loadTicketFor` returns null);
  - returns 400 with no files;
  - returns 400 with more than 5 files;
  - returns 413 for a file over 10 MB;
  - returns 415 for a non-image (`isAllowedImage` false);
  - returns 201 and calls `addAttachment` once per file.
- Masked view:
  - returns 202 for `pending`;
  - for `needs_check`, returns 403 to a viewer and the image to staff;
  - for `clean`, returns the image to a viewer with headers `content-type: image/png` and `cache-control: private, no-store`.
- Original:
  - asks for `"attachments:original"`;
  - writes `logActivity` with action `attachment.original_viewed`;
  - returns 410 when `originalKey` is null.
- Check:
  - `confirm` calls `confirmAttachment`;
  - `mask` with valid boxes calls `remask`;
  - `mask` with an empty or oversized box list returns 400 (at most 50 boxes; each box has non-negative numbers and positive w and h);
  - returns 409 while `pending`.
- Ticket list:
  - `attention=screens` adds `attachments: { some: { status: "needs_check" } }` to the where;
  - a viewer gets `screensToCheck: 0`.

Run them. Expected: FAIL.

- [ ] **Step 2: Routes**

Create `src/app/api/tickets/[id]/attachments/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { loadTicketFor } from "@/lib/tickets/load";
import { addAttachment, MAX_BYTES } from "@/lib/attachments/service";
import { isAllowedImage } from "@/lib/privacy/ic-image";
import { logger } from "@/lib/logger";

type Ctx = { params: Promise<{ id: string }> };
const MAX_FILES = 5;

export const POST = withAuth("tickets:update", async (request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const ticket = await loadTicketFor(auth, id);
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "Add at least one image" }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `At most ${MAX_FILES} images at a time` }, { status: 400 });

  const buffers: { name: string; data: Buffer }[] = [];
  for (const f of files) {
    if (f.size > MAX_BYTES) return NextResponse.json({ error: `${f.name} is over 10 MB` }, { status: 413 });
    const data = Buffer.from(await f.arrayBuffer());
    if (!(await isAllowedImage(data))) return NextResponse.json({ error: `${f.name} isn't a PNG, JPEG or WebP image` }, { status: 415 });
    buffers.push({ name: f.name, data });
  }

  try {
    const rows = [];
    for (const b of buffers) rows.push(await addAttachment({ ticketId: id, fileName: b.name, data: b.data }));
    return NextResponse.json({ data: rows.map(toRow) }, { status: 201 });
  } catch (error) {
    logger.error("upload failed", error);
    return NextResponse.json({ error: "Couldn't save the image" }, { status: 500 });
  }
});

export function toRow(a: {
  id: string;
  messageId: string | null;
  fileName: string;
  status: string;
  icCount: number;
  width: number;
  height: number;
  checkNote: string;
  originalDeletedAt: Date | null;
  createdAt: Date;
}) {
  const { id, messageId, fileName, status, icCount, width, height, checkNote, originalDeletedAt, createdAt } = a;
  return { id, messageId, fileName, status, icCount, width, height, checkNote, originalDeletedAt, createdAt };
}
```

Next only allows the HTTP method names as exports from a route file. Move `toRow` to `src/lib/attachments/row.ts` and import it here and in the other routes.

Create a shared loader in `src/lib/attachments/load.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { loadTicketFor } from "@/lib/tickets/load";

// an attachment is visible when its ticket is
export async function loadAttachmentFor(auth: { role: string; userId: string }, id: string) {
  const a = await prisma.attachment.findUnique({ where: { id } });
  if (!a || !(await loadTicketFor(auth, a.ticketId))) return null;
  return a;
}
```

Create `src/app/api/attachments/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { hasPermission } from "@/lib/rbac";
import { fileStore } from "@/lib/storage";
import { loadAttachmentFor } from "@/lib/attachments/load";

type Ctx = { params: Promise<{ id: string }> };
const IMAGE_HEADERS = { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff" };

export const GET = withAuth("tickets:read", async (_request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const a = await loadAttachmentFor(auth, id);
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (a.status === "pending" || !a.maskedKey) return NextResponse.json({ status: "pending" }, { status: 202 });
  if (a.status === "needs_check" && !hasPermission(auth.role, "attachments:original")) {
    return NextResponse.json({ error: "Waiting for staff to check this image" }, { status: 403 });
  }
  return new NextResponse(new Uint8Array(await fileStore().get(a.maskedKey)), { headers: IMAGE_HEADERS });
});
```

Create `src/app/api/attachments/[id]/original/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { fileStore } from "@/lib/storage";
import { decryptBuffer } from "@/lib/secrets";
import { logActivity } from "@/lib/activity";
import { normalizeImage } from "@/lib/privacy/ic-image";
import { loadAttachmentFor } from "@/lib/attachments/load";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withAuth("attachments:original", async (_request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const a = await loadAttachmentFor(auth, id);
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!a.originalKey) return NextResponse.json({ error: "The original was deleted after the retention period" }, { status: 410 });
  const { png } = await normalizeImage(decryptBuffer(await fileStore().get(a.originalKey)));
  await logActivity("attachment.original_viewed", "attachment", id, `Viewed an original screenshot (${a.fileName})`, auth.name);
  return new NextResponse(new Uint8Array(png), {
    headers: { "content-type": "image/png", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
});
```

The original is served normalised, so box coordinates drawn on it match the masked copy.

Create `src/app/api/attachments/[id]/check/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/tenant/with-auth";
import { validateBody } from "@/lib/validations";
import { loadAttachmentFor } from "@/lib/attachments/load";
import { confirmAttachment, remask } from "@/lib/attachments/process";
import { toRow } from "@/lib/attachments/row";

type Ctx = { params: Promise<{ id: string }> };
const box = z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().positive(), h: z.number().positive() });
const checkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("mask"), boxes: z.array(box).min(1).max(50) }),
]);

export const POST = withAuth("attachments:original", async (request: NextRequest, auth, { params }: Ctx) => {
  const { id } = await params;
  const a = await loadAttachmentFor(auth, id);
  if (!a) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (a.status === "pending") return NextResponse.json({ error: "Still checking this image" }, { status: 409 });
  const validation = validateBody(checkSchema, await request.json().catch(() => ({})));
  if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
  const actor = { id: auth.userId, name: auth.name };
  try {
    const updated =
      validation.data.action === "confirm" ? await confirmAttachment(id, actor) : await remask(id, validation.data.boxes, actor);
    return NextResponse.json(toRow(updated));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "the original was deleted") return NextResponse.json({ error: "The original was deleted" }, { status: 410 });
    throw error;
  }
});
```

- [ ] **Step 3: Ticket routes and deletes**

- `GET /api/tickets/:id`: add `attachments: { orderBy: { createdAt: "asc" }, select: { id, messageId, fileName, status, icCount, width, height, checkNote, originalDeletedAt, createdAt } }` to the `include`.
- `DELETE /api/tickets/:id`: call `await removeAttachmentFiles({ ticketId: id })` before deleting the ticket.
- `DELETE /api/conversations/:id`: call `await removeAttachmentFiles({ ticket: { conversationId: id } })` before deleting.
- `src/lib/gdpr.ts`:
  - The delete branch: before the customer's conversations are deleted, call `removeAttachmentFiles({ ticket: { conversation: { customerId } } })`.
  - The anonymize branch: call the same function, then `prisma.attachment.deleteMany` with that same where. Anonymized screenshots must go completely.
- `GET /api/tickets`:
  - When `attention=screens`, push `{ status: { not: "closed" }, attachments: { some: { status: "needs_check" } } }` into `filters`.
  - Compute `screensToCheck` as `prisma.ticket.count` over `[...filters, { status: { not: "closed" } }, { attachments: { some: { status: "needs_check" } } }]`, taken before the attention filter is pushed. It is `0` when `!hasPermission(auth.role, "attachments:original")`.
  - Return it next to `slaCounts`.

Run the API tests and `tests/unit/route-guard.test.ts`. Expected: PASS.

- [ ] **Step 4: Check by hand, then commit**

With the dev server running, log in as admin once with curl and keep the cookie. Then:
1. Quick add a ticket.
2. Upload a PNG made with the SVG trick from Task 3 to `/api/tickets/<id>/attachments`.
3. GET the masked image and confirm it's a PNG.
4. GET the original and confirm it's a PNG and that an audit row exists:

```bash
PGPASSWORD=helpplus_dev_2026 /c/ServBay/packages/postgresql/18/bin/psql.exe -h localhost -U helpplus -d helpplus -tAc "select action from \"ActivityLog\" order by \"createdAt\" desc limit 1"
```

Afterwards delete the test ticket through the API, and check that its folder under `storage/` is gone.

Run `npx tsc --noEmit`, `npx vitest run` and `npm run test:integration`.

```bash
git add src/app/api src/lib/attachments src/lib/gdpr.ts tests/api
git commit -m "screenshot upload, masked and original views, staff checks"
```

---

### Task 5: Screenshots in the ticket UI

**Files:**
- Create: `src/components/tickets/screenshots.tsx`, `src/components/tickets/mask-editor.tsx`, `src/lib/attachments/client.ts`, `tests/unit/mask-editor-math.test.ts`
- Modify:
  - `src/app/(dashboard)/tickets/[id]/page.tsx`
  - `src/components/tickets/quick-add-dialog.tsx`
  - `src/app/(dashboard)/tickets/page.tsx` ("Screens to check" chip)
  - `src/lib/hooks/use-company.ts` and `src/app/api/company/route.ts` (`canCheckScreens`)

**Interfaces:**
- Consumes: the Task 4 HTTP API.
- Produces:
  - `toImageBox(rect: { x: number; y: number; w: number; h: number }, shown: { width: number; height: number }, natural: { width: number; height: number }): Box`. It converts a rectangle drawn on the displayed image into image pixels and clamps it to the image.
  - `uploadScreenshots(ticketId: string, files: File[]): Promise<{ ok: true } | { ok: false; error: string }>`
  - `useCompany()` gains `canCheckScreens: boolean`.

- [ ] **Step 1: Box maths, test first**

Create `tests/unit/mask-editor-math.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toImageBox } from "@/lib/attachments/client";

describe("toImageBox", () => {
  it("scales from the shown size to the real size", () => {
    expect(toImageBox({ x: 10, y: 20, w: 50, h: 10 }, { width: 400, height: 200 }, { width: 800, height: 400 })).toEqual({
      x: 20,
      y: 40,
      w: 100,
      h: 20,
    });
  });

  it("handles a box drawn backwards", () => {
    expect(toImageBox({ x: 60, y: 30, w: -50, h: -10 }, { width: 400, height: 200 }, { width: 400, height: 200 })).toEqual({
      x: 10,
      y: 20,
      w: 50,
      h: 10,
    });
  });

  it("clamps to the image", () => {
    const b = toImageBox({ x: 380, y: 190, w: 100, h: 100 }, { width: 400, height: 200 }, { width: 400, height: 200 });
    expect(b.x + b.w).toBeLessThanOrEqual(400);
    expect(b.y + b.h).toBeLessThanOrEqual(200);
  });
});
```

Create `src/lib/attachments/client.ts`. It is browser-safe: it must not import Prisma, sharp or node modules.

```ts
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function toImageBox(
  rect: Box,
  shown: { width: number; height: number },
  natural: { width: number; height: number }
): Box {
  const sx = natural.width / shown.width;
  const sy = natural.height / shown.height;
  const x0 = Math.max(0, Math.min(rect.x, rect.x + rect.w) * sx);
  const y0 = Math.max(0, Math.min(rect.y, rect.y + rect.h) * sy);
  const x1 = Math.min(natural.width, Math.max(rect.x, rect.x + rect.w) * sx);
  const y1 = Math.min(natural.height, Math.max(rect.y, rect.y + rect.h) * sy);
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

export async function uploadScreenshots(ticketId: string, files: File[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  try {
    const res = await fetch(`/api/tickets/${ticketId}/attachments`, { method: "POST", body: form });
    if (res.ok) return { ok: true };
    const d = await res.json().catch(() => ({}));
    return { ok: false, error: typeof d.error === "string" ? d.error : "Couldn't upload" };
  } catch {
    return { ok: false, error: "Couldn't upload" };
  }
}
```

Run the test. Expected: PASS.

- [ ] **Step 2: Company flag**

- `GET /api/company` adds `canCheckScreens: hasPermission(auth.role, "attachments:original")`.
- `useCompany` adds `canCheckScreens: boolean`, with `false` in the empty fallback.
- Update the company test.

- [ ] **Step 3: Screenshots component**

Create `src/components/tickets/screenshots.tsx`. Its props: `ticketId`, `attachments: AttachmentRow[]`, `canCheck: boolean`, `onChanged: () => void`.

- A strip of thumbnails, wrapping, 96 px tall, rounded and bordered. Each one loads `/api/attachments/:id` in an `<img>`.
- Under each thumbnail, a status line made of a dot and text:
  - `pending`: "Checking for IC…", grey dot.
  - `clean`: "No IC found", green `#12B76A`.
  - `masked`: "IC covered (n)", indigo `#3B3FA6`.
  - `needs_check`: "Needs check", orange `#F79009`.
  - `originalDeletedAt` set: append " · original deleted".
- While any item is `pending`, poll `onChanged` every 3 seconds, at most 20 times.
- `needs_check` and `canCheck` false: show a grey placeholder tile with "Waiting for staff to check". Don't request the image.
- Clicking a thumbnail opens a viewer in a modal, or a bottom sheet on phones:
  - It shows the masked image.
  - When `canCheck`, it also has these buttons:
    - "Show original": loads `/original` into the same viewer, with the note "Viewing the original is logged".
    - "Cover an area": opens the mask editor.
    - "Looks fine" (only for `needs_check`): POSTs `{ action: "confirm" }`.
  - Errors appear in `text-helplus-danger`, and buttons are disabled while a request runs.
- An "Add screenshot" button with lucide `ImagePlus` opens a hidden `<input type="file" accept="image/png,image/jpeg,image/webp" multiple>`. Pasting an image while the ticket page is focused (the `paste` event with `clipboardData.files`) also uploads. Both use `uploadScreenshots`, then `onChanged`. Show the upload error inline.

Create `src/components/tickets/mask-editor.tsx`:
- It shows the original image, loaded from `/api/attachments/:id/original`.
- The user drags rectangles over it with mouse or touch (`pointerdown`, `pointermove`, `pointerup` on a positioned overlay, `touch-action: none`). Each finished rectangle is drawn as a semi-transparent black box.
- "Undo last" removes the last box. "Save" converts every box with `toImageBox` (shown size from `getBoundingClientRect`, natural size from `img.naturalWidth/Height`), then POSTs `{ action: "mask", boxes }`. "Cancel" closes.
- Save is disabled with no boxes and while saving.
- It must work on a 390 px wide phone: the image scales to the width and the boxes still map correctly.

- [ ] **Step 4: Wire it in**

- Ticket page (`src/app/(dashboard)/tickets/[id]/page.tsx`):
  - Add `attachments` to the `Ticket` type.
  - Render `<Screenshots>` under the messages and above the reply box, passing `canCheck={useCompany().canCheckScreens}` and `onChanged={load}`.
  - Messages that have attachments (`attachment.messageId === m.id`) show a lucide `Paperclip` icon (14 px, `text-helplus-text-light`) and the count next to the time.
- Quick add dialog:
  - Add a drop zone and file picker under the text area: "Drop or paste screenshots (PNG, JPEG, WebP)". Show the chosen file names with a remove ×.
  - After the ticket is created, call `uploadScreenshots(ticket.id, files)`, then open the ticket.
  - If the upload fails, still open the ticket, and show the error there by passing it as a query string `?uploadError=` that the ticket page displays once.
- Inbox: add a chip `{ key: "screens", label: "Screens to check", status: "open", attention: "screens" }` after "Due soon".
  - Only show it when `useCompany().canCheckScreens`.
  - Its count comes from `screensToCheck`.
  - Pass `attention` to the API.

- [ ] **Step 5: Check and commit**

Run `npx tsc --noEmit`, `npx vitest run`, `npm run lint` and `npm run smoke`.

Then check by hand with puppeteer as admin. Log in once and save screenshots at 1280 and 390 to `.superpowers/screens-3a/t5-*.png`:
1. Quick add with an attached PNG made by the SVG trick, with the text "IC 900101-14-5678".
2. On the ticket page, the thumbnail shows "IC covered (1)" or "Needs check".
3. Open the viewer, then "Show original".
4. "Cover an area": draw a box and save. The thumbnail updates.
5. The inbox chip shows when there's a needs-check image.

Delete the test ticket afterwards through the API, so its files are removed too.

```bash
git add src/components/tickets src/lib/attachments/client.ts src/app/(dashboard)/tickets src/app/api/company src/lib/hooks/use-company.ts tests
git commit -m "screenshots on tickets with ic checks and manual cover"
```

---

### Task 6: Privacy settings and WhatsApp images

**Files:**
- Create: `src/app/(dashboard)/privacy/page.tsx`, `tests/integration/whatsapp-image.test.ts`
- Modify:
  - `src/components/layout/nav-items.ts` and `tests/unit/nav-items.test.ts`
  - `scripts/smoke-pages.mjs`
  - `src/lib/channels/whatsapp.ts`
  - `src/lib/attachments/service.ts` (add `attachIncomingImage`)
  - `CHANGELOG.md`

**Interfaces:**
- Consumes: `addAttachment`, the `originalRetentionDays` setting, `PUT /api/settings`.
- Produces: `attachIncomingImage(conversationId: string, data: Buffer, fileName: string): Promise<Attachment | null>`.

- [ ] **Step 1: Incoming images, test first**

Create `tests/integration/whatsapp-image.test.ts`. Use the temp storage dir and `closeOcr` in afterAll, as in Task 3.

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { createTicket } from "@/lib/tickets/service";
import { attachIncomingImage } from "@/lib/attachments/service";
import { closeOcr } from "@/lib/ocr/tesseract";

const A = "it-3a-wa";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);
let dir: string;
const png = () => sharp({ create: { width: 200, height: 80, channels: 3, background: "#ffffff" } }).png().toBuffer();

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "helplus-wa-"));
  process.env.HELPLUS_STORAGE_DIR = dir;
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "A", slug: A } });
});

afterAll(async () => {
  await closeOcr();
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("incoming whatsapp images", { timeout: 120_000 }, () => {
  it("land on the open ticket next to the last client message", async () => {
    const t = await asA(() => createTicket({ text: "screen attached" }));
    const a = await asA(async () => attachIncomingImage(t.conversationId!, await png(), "wa.jpg"));
    expect(a?.ticketId).toBe(t.id);
    const msg = await asA(() => prisma.message.findFirst({ where: { conversationId: t.conversationId!, role: "customer" } }));
    expect(a?.messageId).toBe(msg?.id);
  });

  it("are dropped when the conversation has no open ticket", async () => {
    const conv = await asA(() => prisma.conversation.create({ data: { channel: "whatsapp" } }));
    expect(await asA(async () => attachIncomingImage(conv.id, await png(), "wa.jpg"))).toBeNull();
    expect(await asA(() => prisma.attachment.count({ where: { ticket: { conversationId: conv.id } } }))).toBe(0);
  });

  it("ignore files that aren't images", async () => {
    const t = await asA(() => createTicket({ text: "pdf" }));
    expect(await asA(() => attachIncomingImage(t.conversationId!, Buffer.from("%PDF-1.4"), "a.pdf"))).toBeNull();
  });
});
```

Then add to `src/lib/attachments/service.ts`:

```ts
// channel images go on the open ticket, next to the client's latest message
export async function attachIncomingImage(conversationId: string, data: Buffer, fileName: string) {
  if (data.length > MAX_BYTES || !(await isAllowedImage(data))) return null;
  const ticket = await prisma.ticket.findFirst({
    where: { conversationId, status: { not: "closed" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!ticket) return null;
  const message = await prisma.message.findFirst({
    where: { conversationId, role: "customer" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return addAttachment({ ticketId: ticket.id, messageId: message?.id ?? null, fileName, data });
}
```

Import `isAllowedImage` there.

In `src/lib/channels/whatsapp.ts`, find the media branch, which today calls `message.downloadMedia()` and turns the media into text:
- When the mimetype starts with `image/`, keep the text placeholder as it is so `chat()` still creates or updates the ticket.
- After `chat()` returns, call `attachIncomingImage(conversationId, Buffer.from(media.data, "base64"), media.filename || "whatsapp-image.jpg")`.
- Check the variable names in that file and adapt them. The call runs inside the same company context as the rest of the handler.
- Wrap it in try/catch with a log line, so a failed image never breaks message handling.

Run: `npm run test:integration`. Expected: PASS.

- [ ] **Step 2: Privacy & IC page**

Create `src/app/(dashboard)/privacy/page.tsx`. Use the Header "Privacy & IC", with one card:
- Text: "IC numbers are hidden in messages and covered in screenshots. Originals are encrypted and only staff can open them. Every view is logged."
- A select, "Delete original screenshots", with options 30, 60, 90, 180 and 365 days "after the ticket closes". If the stored value isn't one of these, include it as an option too.
- Save with `PUT /api/settings { originalRetentionDays }`. Read the current value from `GET /api/settings`. Show "Saved" or the error, and disable Save while saving.

Nav: in the Settings section group, add `{ name: "Privacy & IC", href: "/privacy" }` after "General & AI". Update `tests/unit/nav-items.test.ts` if it lists Settings items.

`scripts/smoke-pages.mjs`: add `"/privacy"`.

- [ ] **Step 3: Changelog**

Under `[Unreleased]` > `### Changed`, add: "Screenshots on tickets: IC numbers are covered automatically, unclear images wait for a staff check, originals are encrypted, staff-only and deleted 90 days after close (Settings > Privacy & IC). WhatsApp images arrive as screenshots on the ticket."

Under `### Upgrade notes`, add:
- "Screenshots are stored under `storage/` in the app folder (set `HELPLUS_STORAGE_DIR` to change it). Back it up with the database."
- "The first screenshot downloads OCR language data (about 10 MB) into `.cache/tesseract`. The server needs internet access once, or copy that folder in."

- [ ] **Step 4: Check and commit**

Run `npx tsc --noEmit`, `npx vitest run`, `npm run test:integration`, `npm run lint` and `npm run smoke`.

Stop the dev server, run `npx next build` (it must succeed), then restart the dev server.

Check `/privacy` with puppeteer at 1280 and 390: change the value to 30, save, reload, then set it back to 90.

```bash
git add src scripts tests CHANGELOG.md
git commit -m "privacy settings and whatsapp images as screenshots"
```

---

## Done when

- All of these pass: `npx vitest run`, `npm run test:integration`, `npx tsc --noEmit`, `npm run lint` (0 errors), `npm run smoke` and `npx next build`.
- Staff can attach PNG, JPEG or WebP screenshots from quick add, the ticket page (picker or paste) and incoming WhatsApp images.
- Each image is OCR'd on the server.
  - IC numbers found are covered with black boxes.
  - Unclear images are marked "needs check" and hidden from viewers.
  - Staff can view the original (logged), cover more areas, or confirm.
- Originals are encrypted on disk, staff-only, and deleted by the worker after the company's retention days. Deleting a ticket, a conversation or a GDPR delete removes the files.
- The inbox shows "Screens to check" to staff.
- `imageForAi()` returns only `clean` or `masked` images, ready for stage 4.

Not in this plan:
- WhatsApp chat export and old-system import (3B).
- The silent group bot (3C).
- Sending images to the AI (4).
- The S3/MinIO store (deployment).
- Company-specific extra IC patterns.
