export type DateOrder = "dmy" | "mdy";

export interface ChatMessage {
  at: Date;
  sender: string;
  text: string;
  attachment: string | null;
  system: boolean;
  // count of earlier same-minute, same-sender, same-text messages, so album photos get their own key
  seq?: number;
}

const LRM = "\u200e";
// invisible direction marks and BOM that phones sprinkle into exports
export const INVISIBLE = /[\u200e\u200f\u202a-\u202e\ufeff]/g;

// android: "12/10/2026, 9:05 am - Name: text"   iphone: "[12/10/2026, 09:06:12] Name: text"
const LINE =
  /^\u200e?(\[)?(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap]\.?\s?m\.?|ptg|pg|pagi|petang)(?![a-z]))?(?:(?<=\[.*)\]\s*|(?<!\[.*)\s+[-\u2013]\s)(.*)$/i;
const ATTACHED_IOS = /\u200e?<attached:\s*([^>]+?)>/i;
const ATTACHED_ANDROID = /^(.+\.\w{1,5}) \(file attached\)\s*$/i;

const SYSTEM = [
  /^this business (?:uses|is using)\b/i,
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
const SYSTEM_BEFORE_COLON = /^[^:]+? (?:changed the subject|changed the group name|changed the group description|created group) /i;
const QUOTES = new RegExp(`["${String.fromCharCode(0x201c, 0x201d)}]`, "g");
// an odd quote count means the colon sat inside a quoted group name, not after a sender
const unbalanced = (s: string) => (s.match(QUOTES)?.length ?? 0) % 2 === 1;
const ENCRYPTED = /^messages and calls are end-to-end encrypted\b/i;
const MEDIA_LINE = /^(?:<media omitted>|(?:image|video|audio|sticker|gif|document) omitted|.+ \(file attached\))$/i;
const MEDIA_TAIL = /\s*(?:image|video|audio|sticker|gif|document) omitted$/i;

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

interface Body {
  sender: string;
  text: string;
  system: boolean;
  // starts with the invisible mark and isn't media, like iphone group events
  marked: boolean;
}

function splitBody(body: string): Body {
  const colon = body.indexOf(": ");
  const sender = colon > 0 ? body.slice(0, colon).replace(INVISIBLE, "").trim() : "";
  if (!sender || unbalanced(sender) || SYSTEM_BEFORE_COLON.test(body.replace(INVISIBLE, ""))) {
    return { sender: "", text: body, system: true, marked: false };
  }
  const text = body.slice(colon + 2);
  // iphone writes group events as "Group Name: \u200eAli added Siti"
  const marked = text.startsWith(LRM) && !/<attached:|omitted$/i.test(text);
  return { sender, text, system: false, marked };
}

// the encryption notice names the group; a 1:1 contact also sends unmarked lines, so it isn't one
function groupSender(messages: ChatMessage[], marked: boolean[]): string | null {
  const first = messages.findIndex((m, i) => marked[i] && ENCRYPTED.test(m.text));
  if (first < 0) return null;
  const name = messages[first].sender;
  return messages.every((m, i) => m.sender !== name || marked[i]) ? name : null;
}

// text used for keys: media placeholders differ between android, iphone and no-media exports
export function keyText(text: string): string {
  return text
    .replace(INVISIBLE, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !MEDIA_LINE.test(line))
    .map((line) => line.replace(MEDIA_TAIL, ""))
    .join("\n")
    .trim();
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
  const marked: boolean[] = [];

  for (const raw of text.replace(/^\ufeff/, "").split(/\r?\n/)) {
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
    marked.push(body.marked);
  }

  const group = groupSender(messages, marked);
  const seen = new Map<string, number>();
  messages.forEach((msg, i) => {
    if (marked[i]) msg.system = group ? msg.sender === group : isSystemText(msg.text);
    const id = JSON.stringify([Math.floor(msg.at.getTime() / 60_000), msg.sender, keyText(msg.text)]);
    const seq = seen.get(id) ?? 0;
    seen.set(id, seq + 1);
    if (seq > 0) msg.seq = seq;
  });
  return { messages, order, skippedLines };
}
