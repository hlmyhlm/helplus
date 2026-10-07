import Papa from "papaparse";

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

// fields in priority order, used both to resolve clashes and as the guess order
const FIELD_HINTS: [CsvField, string[]][] = [
  ["oldId", ["id", "ticket id", "no"]],
  ["question", ["question", "issue", "description", "masalah"]],
  ["answer", ["answer", "reply", "solution", "jawapan"]],
  ["clientName", ["client", "customer", "name"]],
  ["clientContact", ["phone", "email", "contact"]],
  ["createdAt", ["created", "date", "tarikh"]],
  ["closedAt", ["closed", "resolved"]],
  ["category", ["category"]],
  ["priority", ["priority"]],
];

function matchKind(header: string, hint: string): "exact" | "contains" | null {
  const h = header.toLowerCase().trim();
  if (h === hint) return "exact";
  if (h.includes(hint)) return "contains";
  return null;
}

export function guessMapping(headers: string[]): CsvMapping {
  const mapping: CsvMapping = {};
  const used = new Set<string>();
  // exact matches first, so a short header like "Name" isn't stolen by a looser contains match elsewhere
  for (const pass of ["exact", "contains"] as const) {
    for (const [field, hints] of FIELD_HINTS) {
      if (mapping[field]) continue;
      const header = headers.find(
        (h) => !used.has(h) && hints.some((hint) => matchKind(h, hint) === pass)
      );
      if (header) {
        mapping[field] = header;
        used.add(header);
      }
    }
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
    if (year < 100) year += 2000;
    // which number is the day depends on the file's detected order, same as the chat parser
    [day, month] = order === "dmy" ? [a, b] : [b, a];
    if (slash[4]) {
      hour = Number(slash[4]);
      minute = Number(slash[5]);
      second = slash[6] ? Number(slash[6]) : 0;
      const ampm = slash[7]?.toLowerCase().replace(/[.\s]/g, "");
      if (ampm === "pm" && hour < 12) hour += 12;
      if (ampm === "am" && hour === 12) hour = 0;
    }
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(utcMs);
  // Date.UTC rolls 31 Feb into March; compare back to catch impossible dates instead of accepting the rollover
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
        bad.push({ line, reason: `Can't read date: ${createdRaw}`, raw });
        return;
      }
    }

    let closedAt: Date | null = null;
    const closedRaw = get("closedAt");
    if (closedRaw) {
      closedAt = parseLooseDate(closedRaw, order);
      if (!closedAt) {
        bad.push({ line, reason: `Can't read date: ${closedRaw}`, raw });
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

export function badRowsCsv(bad: BadRow[]): string {
  if (bad.length === 0) return Papa.unparse({ fields: ["reason"], data: [] });
  const columns = Object.keys(bad[0].raw);
  const fields = ["reason", ...columns];
  const data = bad.map((b) => [b.reason, ...columns.map((c) => b.raw[c] ?? "")]);
  return Papa.unparse({ fields, data });
}
