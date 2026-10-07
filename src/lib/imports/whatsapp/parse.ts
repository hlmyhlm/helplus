export type DateOrder = "dmy" | "mdy";

export interface ChatMessage {
  at: Date;
  sender: string;
  text: string;
  attachment: string | null;
  system: boolean;
}

const LRM = "‎";
// invisible direction marks and BOM that phones sprinkle into exports
const INVISIBLE = /[‎‏‪-‮﻿]/g;

// android: "12/10/2026, 9:05 am - Name: text"   iphone: "[12/10/2026, 09:06:12] Name: text"
const LINE =
  /^‎?(\[)?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap]\.?\s?m\.?|ptg|pg|pagi|petang)(?![a-z]))?(?:(?<=\[.*)\]\s*|(?<!\[.*)\s+[-–]\s)(.*)$/i;
const ATTACHED_IOS = /‎?<attached:\s*([^>]+?)>/i;
const ATTACHED_ANDROID = /^(.+\.\w{1,5}) \(file attached\)\s*/i;

const SYSTEM = [
  /^messages and calls are end-to-end encrypted\b/i,
  /^(?:your )?security code with .+ changed\b/i,
  /^.+? (?:added|removed) .+$/i,
  /^.+? left$/i,
  /^.+? joined using this group's invite link$/i,
  /^.+? joined$/i,
  /^.+? changed (?:the subject|this group's icon|the group description|their phone number)\b/i,
  /^.+? created (?:group|this group)\b/i,
];
// group events whose quoted text can contain ": " and fool the sender split
const SYSTEM_BEFORE_COLON = /^[^:]+? (?:changed the subject|changed the group description|created group) /i;

const PM = new Set(["pm", "ptg", "petang"]);
const AM = new Set(["am", "pg", "pagi"]);

export function detectDateOrder(text: string): DateOrder {
  let firstOver = false;
  let secondOver = false;
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    if (Number(m[2]) > 12) firstOver = true;
    if (Number(m[3]) > 12) secondOver = true;
  }
  if (secondOver && !firstOver) return "mdy";
  return "dmy";
}

function toDate(m: RegExpExecArray, order: DateOrder, offsetMinutes: number): Date | null {
  const a = Number(m[2]);
  const b = Number(m[3]);
  let year = Number(m[4]);
  if (year < 100) year += 2000;
  const [day, month] = order === "dmy" ? [a, b] : [b, a];
  let hour = Number(m[5]);
  const minute = Number(m[6]);
  const second = Number(m[7] ?? 0);
  const ampm = m[8]?.toLowerCase().replace(/[.\s]/g, "");
  if (ampm && PM.has(ampm) && hour < 12) hour += 12;
  if (ampm && AM.has(ampm) && hour === 12) hour = 0;
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const local = Date.UTC(year, month - 1, day, hour, minute, second);
  // rejects 30/02 and friends, which Date.UTC would roll over
  if (new Date(local).getUTCDate() !== day) return null;
  return new Date(local - offsetMinutes * 60_000);
}

function isSystemText(text: string): boolean {
  const clean = text.replace(INVISIBLE, "").trim();
  return SYSTEM.some((re) => re.test(clean));
}

function splitBody(body: string): { sender: string; text: string; system: boolean } {
  const colon = body.indexOf(": ");
  if (colon <= 0 || SYSTEM_BEFORE_COLON.test(body.replace(INVISIBLE, ""))) {
    return { sender: "", text: body, system: true };
  }
  const sender = body.slice(0, colon).replace(INVISIBLE, "").trim();
  const text = body.slice(colon + 2);
  // iphone writes group events as "Group Name: ‎Ali added Siti"
  const system = text.startsWith(LRM) && !/<attached:|omitted$/i.test(text) && isSystemText(text);
  return { sender, text, system };
}

function takeAttachment(text: string): { text: string; attachment: string | null } {
  const ios = ATTACHED_IOS.exec(text);
  if (ios) {
    const rest = text.slice(0, ios.index) + text.slice(ios.index + ios[0].length);
    return { attachment: ios[1].trim(), text: rest.replace(INVISIBLE, "").trim() };
  }
  const clean = text.replace(INVISIBLE, "");
  const android = ATTACHED_ANDROID.exec(clean);
  if (android) return { attachment: android[1].trim(), text: clean.slice(android[0].length).trim() };
  return { attachment: null, text: clean };
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
    const body = splitBody(m[9]);
    const { text: msgText, attachment } = takeAttachment(body.text);
    messages.push({ at, sender: body.sender, text: msgText.trim(), attachment, system: body.system });
  }
  return { messages, order, skippedLines };
}
