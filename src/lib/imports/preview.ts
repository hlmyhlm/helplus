import { prisma } from "@/lib/prisma";
import { maskIC } from "@/lib/privacy/ic-mask";
import { readExport } from "./whatsapp/zip";
import { parseChat, type DateOrder } from "./whatsapp/parse";
import { groupIssues } from "./whatsapp/group";
import { readCsv, headersSignature } from "./csv/parse";
import { checkRows, guessMapping, type CsvMapping, type GoodRow } from "./csv/rows";

export const MAX_ISSUES = 5000;
export const MAX_ROWS = 20000;
const SAMPLE = 5;
const PREVIEW_ROWS = 20;

// a bad file the user can fix, the route turns it into a 4xx
export class PreviewError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const mask = (s: string) => maskIC(s).text;
const digits = (s: string) => s.replace(/\D/g, "");

function samePhone(a: string, b: string): boolean {
  if (a.length < 8 || b.length < 8) return false;
  // one side may carry the country code and the other not
  return a === b || a.endsWith(b) || b.endsWith(a);
}

// saved choices win, otherwise anyone on the team or a user of the app counts as staff
async function staffGuess(senders: string[]): Promise<(name: string) => boolean> {
  const [saved, team, admins] = await Promise.all([
    prisma.chatSender.findMany({ where: { name: { in: senders } }, select: { name: true, isStaff: true } }),
    prisma.teamMember.findMany({ select: { name: true, phone: true } }),
    prisma.admin.findMany({ select: { name: true } }),
  ]);
  const choice = new Map(saved.map((s) => [s.name, s.isStaff]));
  const names = new Set([...team.map((t) => t.name), ...admins.map((a) => a.name)].map((n) => n.trim().toLowerCase()).filter(Boolean));
  const phones = team.map((t) => digits(t.phone)).filter((p) => p.length >= 8);
  return (name) => {
    const saved = choice.get(name);
    if (saved !== undefined) return saved;
    if (names.has(name.trim().toLowerCase())) return true;
    const d = digits(name);
    return /^\+?[\d\s()-]+$/.test(name) && phones.some((p) => samePhone(p, d));
  };
}

export async function whatsappPreview(data: Buffer, fileName: string) {
  let chat: string;
  let skippedFiles: number;
  let files: Map<string, Buffer>;
  try {
    ({ chat, files, skippedFiles } = readExport(data, fileName));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/too large/.test(message)) throw new PreviewError("Split this file into smaller parts", 413);
    throw new PreviewError("This isn't a WhatsApp export", 400);
  }
  const { messages, order } = parseChat(chat);
  const real = messages.filter((m) => !m.system && m.sender);
  if (!real.length) throw new PreviewError("This isn't a WhatsApp export", 400);

  const counts = new Map<string, number>();
  for (const m of real) counts.set(m.sender, (counts.get(m.sender) ?? 0) + 1);
  const isStaff = await staffGuess([...counts.keys()]);
  const senders = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count, isStaff: isStaff(name) }));
  const staff = new Set(senders.filter((s) => s.isStaff).map((s) => s.name));

  const { issues } = groupIssues(messages, (s) => staff.has(s));
  if (issues.length > MAX_ISSUES) throw new PreviewError("Split this file into smaller parts", 413);

  return {
    order: order as DateOrder,
    senders,
    messages: real.length,
    issues: issues.length,
    answered: issues.filter((i) => i.answered).length,
    attachments: real.filter((m) => m.attachment).length,
    images: files.size,
    skippedFiles,
    sample: issues.slice(0, SAMPLE).map((i) => ({
      client: mask(i.client),
      firstLine: mask(i.messages[0].text.split("\n")[0] || i.messages[0].attachment || "").slice(0, 80),
      answered: i.answered,
    })),
  };
}

function maskRow(r: GoodRow) {
  return {
    line: r.line,
    oldId: mask(r.oldId),
    question: mask(r.question),
    answer: mask(r.answer),
    title: mask(r.title),
    clientName: mask(r.clientName),
    clientContact: mask(r.clientContact),
    createdAt: r.createdAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
    category: mask(r.category),
    priority: r.priority,
  };
}

export async function csvPreview(data: Buffer, order: DateOrder = "dmy") {
  const { headers, rows } = readCsv(data.toString("utf8"));
  if (headers.length < 2 || !rows.length) throw new PreviewError("This isn't a CSV export with a header row", 400);
  if (rows.length > MAX_ROWS) throw new PreviewError("Split this file into smaller parts", 413);

  const saved = await prisma.importMapping.findFirst({ where: { headers: headersSignature(headers) }, select: { mapping: true } });
  const mapping = (saved?.mapping as CsvMapping | undefined) ?? guessMapping(headers);
  const { good, bad } = checkRows(rows, mapping, order);
  return {
    headers,
    mapping,
    rows: good.slice(0, PREVIEW_ROWS).map(maskRow),
    good: good.length,
    bad: bad.length,
  };
}
