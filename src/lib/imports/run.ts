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
import { logger } from "@/lib/logger";

export const BATCH = 200;
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

// staff names are stored masked, so senders are compared masked too
export function staffMatcher(names: string[]): (sender: string) => boolean {
  const staff = new Set(names.map((n) => maskIC(n).text));
  const seen = new Map<string, boolean>();
  return (sender) => {
    let hit = seen.get(sender);
    if (hit === undefined) seen.set(sender, (hit = staff.has(maskIC(sender).text)));
    return hit;
  };
}

const customerText = (messages: ChatMessage[], isStaff: (sender: string) => boolean) =>
  messages.filter((m) => !isStaff(m.sender)).map((m) => m.text).join("\n");

export async function runImportBatch(jobId: string, now: Date, limit = BATCH): Promise<"running" | "done" | "failed"> {
  const job = await prisma.importJob.findFirst({ where: { id: jobId } });
  if (!job) return "failed";
  if (job.status === "done") return "done";
  if (job.status !== "queued" && job.status !== "running") return "failed";
  if (job.status === "queued") {
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "running", startedAt: now } });
  }

  try {
    if (!job.fileKey) throw new Error("The uploaded file is gone, upload it again");
    const data = decryptBuffer(await fileStore().get(job.fileKey));
    const finished = job.kind === "csv" ? await csvBatch(job, data, now, limit) : await whatsappBatch(job, data, limit);
    if (!finished) return "running";

    await fileStore().remove(job.fileKey);
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "done", finishedAt: now, fileKey: null } });
    return "done";
  } catch (error) {
    const message = maskIC(error instanceof Error ? error.message : String(error)).text;
    logger.error("import failed", message);
    // only a running job can fail, so a run that already finished it stays done
    await prisma.importJob.updateMany({ where: { id: job.id, status: "running" }, data: { status: "failed", error: message.slice(0, 500) } });
    return "failed";
  }
}

async function whatsappBatch(job: Job, data: Buffer, limit: number): Promise<boolean> {
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
  const end = Math.min(start + limit, issues.length);
  const merge = { ...(progress.merge ?? {}) };

  // merge decisions are saved so a later batch sees the same issues as this one
  if (await aiReady()) {
    for (let i = start; i < end; i++) {
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

  const ready: { key: string; issue: Issue }[] = [];
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
    ready.push({ key, issue: { ...issue, messages: all, firstAt: all[0].at } });
    carry = [];
    carryKey = null;
  }
  progress.next = end;

  // known tickets go back through the writer to fill crash gaps, known messages mean an overlap cut the issue
  const todo: { key: string; issue: Issue; sorted: ChatMessage[]; messageKeys: string[]; known: boolean }[] = [];
  for (const { key, issue } of ready) {
    const sorted = [...issue.messages].sort((a, b) => a.at.getTime() - b.at.getTime());
    const messageKeys = sorted.map((m) => messageKey(job.projectId, m));
    const ticket = await prisma.ticket.findFirst({ where: { importKey: key }, select: { id: true } });
    if (!ticket && (await prisma.message.findFirst({ where: { importKey: { in: messageKeys } }, select: { id: true } }))) {
      add(stats, "skipped", 1);
      continue;
    }
    todo.push({ key, issue, sorted, messageKeys, known: !!ticket });
  }

  const labels = await tidyIssues(todo.filter((r) => !r.known).map((r) => ({ key: r.key, text: customerText(r.issue.messages, isStaff) })));

  for (const { key, issue, sorted, messageKeys } of todo) {
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
          author: m.sender,
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

async function csvBatch(job: Job, data: Buffer, now: Date, limit: number): Promise<boolean> {
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
  for (const row of good.slice(start, end)) {
    const askedAt = row.createdAt ?? now;
    const closedAt = row.closedAt ?? askedAt;
    const messages: ImportedQa["messages"] = [{ role: "customer", text: row.question, at: askedAt }];
    if (row.answer) messages.push({ role: "agent", text: row.answer, at: closedAt });
    const priority = row.priority.toLowerCase();
    try {
      const result = await writeImportedTicket({
        importKey: `csv:${row.oldId}`,
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
  await prisma.importJob.update({ where: { id: job.id }, data: { progress: { ...progress, next: end } as never, stats } });
  return end >= good.length;
}
