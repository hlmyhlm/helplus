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
