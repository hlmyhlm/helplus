import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { currentCompanyId } from "@/lib/tenant/context";
import { fileStore } from "@/lib/storage";
import { decryptBuffer } from "@/lib/secrets";
import { maskIC } from "@/lib/privacy/ic-mask";
import { readExport } from "./whatsapp/zip";
import { parseChat, type ChatMessage, type DateOrder } from "./whatsapp/parse";
import { groupIssues, issueKey, messageKey, type Issue } from "./whatsapp/group";
import { readCsv, headersSignature } from "./csv/parse";
import { checkRows, guessMapping, type BadRow, type CsvMapping } from "./csv/rows";
import { writeImportedTicket, type ImportedQa, type WriteResult } from "./write";
import { aiReady, sameProblem, tidyIssues } from "./ai-tidy";
import { staffMatcher } from "./whatsapp/staff";
import { ImportError } from "./errors";
import { logger } from "@/lib/logger";

export const BATCH = 200;
// keep one company's big file from holding up the others
const BUDGET_MS = 20_000;
const AI_BATCH = 25;
const GONE = "The uploaded file is gone, upload it again";
const FAILED = "Something went wrong with this import, try again";
const DAY = 86_400_000;
const STALE_MS = 14 * DAY;
const MERGE_WINDOW_MS = DAY;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const PRIORITIES = new Set(["low", "medium", "high", "urgent"]);

export interface ImportOptions {
  order?: DateOrder;
  staff?: string[];
  mapping?: CsvMapping;
}

interface Progress {
  next?: number;
  // issue key -> whether it was folded into the issue after it
  merge?: Record<string, boolean>;
  errors?: string[];
}

type Stats = Record<string, number>;
const MAX_ERRORS = 50;

// one bad item shouldn't stop the batch, note it and carry on
function noteFailure(stats: Stats, progress: Progress, label: string, error: unknown) {
  add(stats, "failed", 1);
  const message = maskIC(`${label}: ${error instanceof Error ? error.message : String(error)}`).text.slice(0, 300);
  logger.error("import item failed", message);
  const errors = progress.errors ?? [];
  if (errors.length < MAX_ERRORS) progress.errors = [...errors, message];
}

type Job = NonNullable<Awaited<ReturnType<typeof prisma.importJob.findFirst>>>;

const add = (stats: Stats, key: string, n: number) => {
  stats[key] = (stats[key] ?? 0) + n;
};

function countWrite(stats: Stats, r: WriteResult) {
  add(stats, r.created ? "created" : "skipped", 1);
  add(stats, "images", r.images);
  add(stats, "skippedImages", r.skippedImages);
}

const customerText = (messages: ChatMessage[], isStaff: (sender: string) => boolean) =>
  messages.filter((m) => !isStaff(m.sender)).map((m) => m.text).join("\n");

const csvKey = (projectId: string, oldId: string) =>
  `csv:${createHash("sha256").update(`${projectId}\u0001${oldId}`).digest("hex")}`;

export async function runImportBatch(
  jobId: string,
  now: Date,
  limit = BATCH,
  budgetMs = BUDGET_MS
): Promise<"running" | "done" | "failed"> {
  const job = await prisma.importJob.findFirst({ where: { id: jobId } });
  if (!job) return "failed";
  if (job.status === "done") return "done";
  if (job.status !== "queued" && job.status !== "running") return "failed";
  if (job.status === "queued") {
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "running", startedAt: now } });
  }

  const started = Date.now();
  const spent = () => Date.now() - started >= budgetMs;
  try {
    if (!job.fileKey) throw new ImportError(GONE);
    const fileKey = job.fileKey;
    const stored = await fileStore()
      .get(fileKey)
      .catch((error) => {
        if ((error as { code?: string })?.code !== "ENOENT") throw error;
        logger.error("import file missing", error);
        throw new ImportError(GONE);
      });
    const data = decryptBuffer(stored);
    const finished = job.kind === "csv" ? await csvBatch(job, data, now, limit, spent) : await whatsappBatch(job, data, limit, spent);
    if (!finished) return "running";

    await fileStore().remove(fileKey);
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "done", finishedAt: now, fileKey: null } });
    return "done";
  } catch (error) {
    // only file problems the user can fix are shown, the rest just gets logged
    const message = error instanceof ImportError ? error.message : FAILED;
    logger.error("import failed", maskIC(error instanceof Error ? (error.stack ?? error.message) : String(error)).text);
    // only a running job can fail, so a run that already finished it stays done
    await prisma.importJob.updateMany({
      where: { id: job.id, status: "running" },
      data: { status: "failed", error: message, finishedAt: now, ...(message === GONE ? { fileKey: null } : {}) },
    });
    return "failed";
  }
}

async function whatsappBatch(job: Job, data: Buffer, limit: number, spent: () => boolean): Promise<boolean> {
  const options = job.options as ImportOptions;
  const progress = { ...(job.progress as Progress) };
  const stats = { ...(job.stats as Stats) };
  const isStaff = staffMatcher(options.staff ?? []);

  const { chat, files, skippedFiles } = readExport(data, job.fileName);
  const { messages } = parseChat(chat, { order: options.order });
  const { issues, announcements } = groupIssues(messages, isStaff);
  const newestAt = messages.reduce((max, m) => Math.max(max, m.at.getTime()), 0);
  const keys = issues.map((i) => issueKey(job.projectId, i));

  const start = progress.next ?? 0;
  const ai = await aiReady();
  // title calls are slow, so a smaller batch keeps them inside the time budget
  let end = Math.min(start + (ai ? Math.min(limit, AI_BATCH) : limit), issues.length);
  const merge = { ...(progress.merge ?? {}) };

  // merge decisions are saved so a later batch sees the same issues as this one
  if (ai) {
    for (let i = start; i < end; i++) {
      if (i > start && spent()) {
        end = i;
        break;
      }
      const a = issues[i];
      const b = issues[i + 1];
      if (!b || a.answered || a.client !== b.client || keys[i] in merge) continue;
      if (b.firstAt.getTime() - a.lastAt.getTime() > MERGE_WINDOW_MS) continue;
      merge[keys[i]] = await sameProblem(customerText(a.messages, isStaff), customerText(b.messages, isStaff));
    }
  }

  // an issue folded into the next one may sit just before this batch
  let carry: ChatMessage[] = [];
  let carryKey: string | null = null;
  for (let j = start - 1; j >= 0 && merge[keys[j]]; j--) {
    carry = [...issues[j].messages, ...carry];
    carryKey = keys[j];
  }

  const ready: { key: string; issue: Issue; last: number }[] = [];
  for (let i = start; i < end; i++) {
    const issue = issues[i];
    const key = carryKey ?? keys[i];
    // a folded issue goes out with whichever batch holds its last piece
    if (merge[keys[i]] && i + 1 < issues.length) {
      carry = [...carry, ...issue.messages];
      carryKey = key;
      continue;
    }
    const all = [...carry, ...issue.messages];
    ready.push({ key, issue: { ...issue, messages: all, firstAt: all[0].at }, last: i });
    carry = [];
    carryKey = null;
  }
  progress.next = end;

  // a known ticket goes back through the writer to fill gaps, a known message means an overlap cut the issue
  const todo: { key: string; issue: Issue; last: number; sorted: ChatMessage[]; messageKeys: string[]; known: boolean; cut: boolean }[] = [];
  for (const { key, issue, last } of ready) {
    const sorted = [...issue.messages].sort((a, b) => a.at.getTime() - b.at.getTime());
    const messageKeys = sorted.map((m) => messageKey(job.projectId, m));
    const ticket = await prisma.ticket.findFirst({ where: { importKey: key }, select: { id: true } });
    const cut = !ticket && !!(await prisma.message.findFirst({ where: { importKey: { in: messageKeys } }, select: { id: true } }));
    todo.push({ key, issue, last, sorted, messageKeys, known: !!ticket, cut });
  }

  const labels = await tidyIssues(
    todo.filter((r) => !r.known && !r.cut).map((r) => ({ key: r.key, text: customerText(r.issue.messages, isStaff) }))
  );

  for (let n = 0; n < todo.length; n++) {
    if (n > 0 && spent()) {
      progress.next = todo[n - 1].last + 1;
      break;
    }
    const { key, issue, sorted, messageKeys, cut } = todo[n];
    if (cut) {
      add(stats, "skipped", 1);
      continue;
    }
    const images: NonNullable<ImportedQa["images"]> = [];
    let missing = 0;
    sorted.forEach((m, index) => {
      if (!m.attachment || !IMAGE.test(m.attachment)) return;
      const file = files.get(m.attachment);
      if (file) images.push({ fileName: m.attachment, data: file, messageIndex: index });
      else missing++;
    });
    const stale = !issue.answered && issue.lastAt.getTime() < newestAt - STALE_MS;
    const label = labels.get(key);
    try {
      const result = await writeImportedTicket({
        importKey: key,
        projectId: job.projectId,
        source: "whatsapp_export",
        channel: "whatsapp",
        title: label?.title,
        category: label?.category,
        client: { name: issue.client, contact: /^\+?[\d\s()-]{8,}$/.test(issue.client) ? issue.client : undefined },
        messages: sorted.map((m, i) => ({
          role: isStaff(m.sender) ? "agent" : "customer",
          text: m.text || m.attachment || "",
          at: m.at,
          importKey: messageKeys[i],
        })),
        status: issue.answered || stale ? "closed" : "new",
        closeNote: stale ? "No reply in the imported chat" : undefined,
        closedAt: stale ? issue.lastAt : undefined,
        images,
      });
      countWrite(stats, result);
      add(stats, "missingMedia", missing);
    } catch (error) {
      noteFailure(stats, progress, `${issue.client}, ${issue.firstAt.toISOString()}`, error);
    }
  }

  stats.total = issues.length;
  stats.announcements = announcements;
  stats.merged = Object.values(merge).filter(Boolean).length;
  stats.skippedFiles = skippedFiles;
  for (const k of ["created", "skipped", "failed", "images", "skippedImages", "missingMedia"]) stats[k] ??= 0;
  await prisma.importJob.update({
    where: { id: job.id },
    data: { progress: { ...progress, merge } as never, stats },
  });
  return progress.next >= issues.length;
}

async function csvBatch(job: Job, data: Buffer, now: Date, limit: number, spent: () => boolean): Promise<boolean> {
  const options = job.options as ImportOptions;
  const progress = { ...(job.progress as Progress) };
  const stats = { ...(job.stats as Stats) };
  const first = progress.next === undefined;

  const { headers, rows } = readCsv(data.toString("utf8"));
  const mapping = options.mapping ?? guessMapping(headers);
  const { good, bad } = checkRows(rows, mapping, options.order ?? "dmy");

  if (first) {
    const masked: BadRow[] = bad.map((b) => ({
      ...b,
      raw: Object.fromEntries(Object.entries(b.raw).map(([k, v]) => [k, maskIC(String(v ?? "")).text])),
    }));
    const signature = headersSignature(headers);
    await prisma.importMapping.upsert({
      where: { companyId_headers: { companyId: currentCompanyId(), headers: signature } },
      create: { headers: signature, mapping },
      update: { mapping },
    });
    await prisma.importJob.update({ where: { id: job.id }, data: { badRows: masked as never } });
  }

  const start = progress.next ?? 0;
  const end = Math.min(start + limit, good.length);
  let next = start;
  for (; next < end; next++) {
    if (next > start && spent()) break;
    const row = good[next];
    const askedAt = row.createdAt ?? now;
    const closedAt = row.closedAt ?? askedAt;
    const messages: ImportedQa["messages"] = [{ role: "customer", text: row.question, at: askedAt }];
    if (row.answer) messages.push({ role: "agent", text: row.answer, at: closedAt });
    const priority = row.priority.toLowerCase();
    try {
      const result = await writeImportedTicket({
        importKey: csvKey(job.projectId, row.oldId),
        projectId: job.projectId,
        source: "old_system",
        channel: "import",
        title: row.title || undefined,
        category: row.category || undefined,
        priority: PRIORITIES.has(priority) ? priority : undefined,
        client: { name: row.clientName || row.clientContact || "Unknown", contact: row.clientContact || undefined },
        messages,
        status: "closed",
        closedAt,
      });
      countWrite(stats, result);
    } catch (error) {
      noteFailure(stats, progress, `Line ${row.line}`, error);
    }
  }

  stats.total = good.length;
  stats.bad = bad.length;
  for (const k of ["created", "skipped", "failed"]) stats[k] ??= 0;
  await prisma.importJob.update({ where: { id: job.id }, data: { progress: { ...progress, next } as never, stats } });
  return next >= good.length;
}
