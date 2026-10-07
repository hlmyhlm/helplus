import Papa from "papaparse";
import { maskIC } from "@/lib/privacy/ic-mask";

export type CsvField =
  | "oldId"
  | "question"
  | "answer"
  | "title"
  | "clientName"
  | "clientContact"
  | "createdAt"
  | "closedAt"
  | "category"
  | "priority";

export type CsvMapping = Partial<Record<CsvField, string>>;

export interface GoodRow {
  line: number;
  oldId: string;
  question: string;
  answer: string;
  title: string;
  clientName: string;
  clientContact: string;
  createdAt: Date | null;
  closedAt: Date | null;
  category: string;
  priority: string;
}

export interface BadRow {
  line: number;
  reason: string;
  raw: Record<string, string>;
}

// tier marks how specific a field's hint words are; contact words beat the generic client/name ones
const FIELD_DEFS: { field: CsvField; tier: number; hints: string[] }[] = [
  { field: "oldId", tier: 2, hints: ["id", "ticket id", "no"] },
  { field: "question", tier: 2, hints: ["question", "issue", "description", "masalah"] },
  { field: "answer", tier: 2, hints: ["answer", "reply", "solution", "jawapan"] },
  { field: "clientName", tier: 1, hints: ["client", "customer", "name", "nama"] },
  { field: "clientContact", tier: 3, hints: ["phone", "email", "contact", "tel", "mobile"] },
  { field: "createdAt", tier: 2, hints: ["created", "date", "tarikh", "opened", "dibuka"] },
  { field: "closedAt", tier: 2, hints: ["closed", "resolved", "tutup"] },
  { field: "category", tier: 2, hints: ["category"] },
  { field: "priority", tier: 2, hints: ["priority"] },
];

// too generic to name a field, "Closed Date" is decided by "Closed"
const GENERIC_LAST_WORDS = new Set(["date", "time", "tarikh", "masa"]);
const DATE_FIELDS: ReadonlySet<CsvField> = new Set(["createdAt", "closedAt"]);

// a trailing number word doesn't name the field either - "Phone No" is a phone, not an id
const NUMBER_WORDS = new Set(["no", "number", "num", "nombor", "bil"]);
const NO_BONUS_WORDS = new Set([...GENERIC_LAST_WORDS, ...NUMBER_WORDS]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lastWord(header: string): string {
  const words = header.split(/[\s_\-.]+/).filter(Boolean);
  return words[words.length - 1] ?? "";
}

// exact match wins, then tier, whole words and the header's last word ("Contact Phone" is a phone)
function hintScore(
  header: string,
  hint: string,
  tier: number,
  last: string,
  field: CsvField
): number | null {
  if (GENERIC_LAST_WORDS.has(last) && !DATE_FIELDS.has(field)) return null;
  if (header === hint) return 10_000;
  const whole = new RegExp(`\\b${escapeRegExp(hint)}\\b`).test(header);
  let score: number;
  if (whole) score = tier * 100 + hint.length * 10 + 5;
  else if (header.includes(hint)) score = tier * 100 + hint.length * 10;
  else return null;
  if (hint === last && !NO_BONUS_WORDS.has(hint)) score += 1000;
  return score;
}

export function guessMapping(headers: string[]): CsvMapping {
  const candidates: { header: string; field: CsvField; score: number }[] = [];
  for (const header of headers) {
    const h = header.toLowerCase().trim();
    const last = lastWord(h);
    for (const { field, tier, hints } of FIELD_DEFS) {
      let best: number | null = null;
      for (const hint of hints) {
        const score = hintScore(h, hint, tier, last, field);
        if (score !== null && (best === null || score > best)) best = score;
      }
      if (best !== null) candidates.push({ header, field, score: best });
    }
  }
  // highest score first, so each header and each field get their best mutual match
  candidates.sort((a, b) => b.score - a.score);

  const mapping: CsvMapping = {};
  const usedHeaders = new Set<string>();
  const usedFields = new Set<CsvField>();
  for (const c of candidates) {
    if (usedHeaders.has(c.header) || usedFields.has(c.field)) continue;
    mapping[c.field] = c.header;
    usedHeaders.add(c.header);
    usedFields.add(c.field);
  }
  return mapping;
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const SLASH_DATE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?)?$/i;

export function parseLooseDate(s: string, order: "dmy" | "mdy", offsetMinutes = 480): Date | null {
  const trimmed = s.trim();
  if (!trimmed) return null;

  let year: number;
  let month: number;
  let day: number;
  let hour = 0;
  let minute = 0;
  let second = 0;

  const iso = ISO_DATE.exec(trimmed);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
    hour = iso[4] ? Number(iso[4]) : 0;
    minute = iso[5] ? Number(iso[5]) : 0;
    second = iso[6] ? Number(iso[6]) : 0;
  } else {
    const slash = SLASH_DATE.exec(trimmed);
    if (!slash) return null;
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    year = Number(slash[3]);
    // two-digit years pivot at 70: 00-69 is 20xx, 70-99 is 19xx
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    // which number is the day depends on the file's detected order, same as the chat parser
    [day, month] = order === "dmy" ? [a, b] : [b, a];
    if (slash[4]) {
      hour = Number(slash[4]);
      minute = Number(slash[5]);
      second = slash[6] ? Number(slash[6]) : 0;
      const ampm = slash[7]?.toLowerCase().replace(/[.\s]/g, "");
      if (ampm) {
        // a 12-hour clock only runs 1-12
        if (hour < 1 || hour > 12) return null;
        if (ampm === "pm" && hour < 12) hour += 12;
        if (ampm === "am" && hour === 12) hour = 0;
      }
    }
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(utcMs);
  // Date.UTC rolls 31 Feb into March, so check it came back the same
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return new Date(utcMs - offsetMinutes * 60_000);
}

export function checkRows(
  rows: Record<string, string>[],
  mapping: CsvMapping,
  order: "dmy" | "mdy"
): { good: GoodRow[]; bad: BadRow[] } {
  const good: GoodRow[] = [];
  const bad: BadRow[] = [];
  const seenIds = new Set<string>();

  rows.forEach((raw, i) => {
    const line = i + 2; // the header itself counts as line 1
    const get = (field: CsvField): string => {
      const header = mapping[field];
      return header ? (raw[header] ?? "").trim() : "";
    };

    const oldId = get("oldId");
    if (!oldId) {
      bad.push({ line, reason: "Missing ID", raw });
      return;
    }
    if (seenIds.has(oldId)) {
      bad.push({ line, reason: "ID repeated in the file", raw });
      return;
    }
    seenIds.add(oldId);

    const question = get("question");
    if (!question) {
      bad.push({ line, reason: "Missing question", raw });
      return;
    }

    let createdAt: Date | null = null;
    const createdRaw = get("createdAt");
    if (createdRaw) {
      createdAt = parseLooseDate(createdRaw, order);
      if (!createdAt) {
        bad.push({ line, reason: `Can't read date: ${maskIC(createdRaw).text}`, raw });
        return;
      }
    }

    let closedAt: Date | null = null;
    const closedRaw = get("closedAt");
    if (closedRaw) {
      closedAt = parseLooseDate(closedRaw, order);
      if (!closedAt) {
        bad.push({ line, reason: `Can't read date: ${maskIC(closedRaw).text}`, raw });
        return;
      }
    }

    good.push({
      line,
      oldId,
      question,
      answer: get("answer"),
      title: get("title"),
      clientName: get("clientName"),
      clientContact: get("clientContact"),
      createdAt,
      closedAt,
      category: get("category"),
      priority: get("priority"),
    });
  });

  return { good, bad };
}

// a leading =, +, -, @, tab or carriage return can be read as a formula by spreadsheet apps
const FORMULA_START = /^[=+\-@\t\r]/;

function sanitizeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

export function badRowsCsv(bad: BadRow[]): string {
  if (bad.length === 0) return "reason";
  const columns = Object.keys(bad[0].raw);
  const fields = ["reason", ...columns];
  const data = bad.map((b) => [
    sanitizeCell(b.reason),
    ...columns.map((c) => sanitizeCell(b.raw[c] ?? "")),
  ]);
  return Papa.unparse({ fields, data });
}
