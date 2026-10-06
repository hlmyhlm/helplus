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

// chars allowed between or inside ic groups: space, dashes, dot, tilde, slash, comma, underscore
const SEP_CLASS = String.raw`\s\-–—.~/,_`;
const SEP_RE = new RegExp(`[${SEP_CLASS}]`);
// six digits, 0-3 separators, two digits, 0-3 separators, four digits; one space may sit inside a group
const IMAGE_IC = new RegExp(
  String.raw`(?<!\d)\d(?:\s?\d){5}[${SEP_CLASS}]{0,3}\d\s?\d[${SEP_CLASS}]{0,3}\d(?:\s?\d){3}(?!\d)`,
  "g",
);
const LOOKALIKE: Record<string, string> = {
  O: "0", o: "0", D: "0", I: "1", l: "1", "|": "1", S: "5", s: "5", B: "8", Z: "2", g: "9", q: "9",
};

const digits = (t: string) => (t.match(/\d/g) ?? []).length;
const isDigit = (c: string) => c >= "0" && c <= "9";
const isLookalike = (c: string) => LOOKALIKE[c] !== undefined;
const isSep = (c: string) => SEP_RE.test(c);

// a lookalike becomes a digit when its run of digits/lookalikes/separators is at least half real digits
function allVariant(text: string): string {
  const chars = [...text];
  const out = chars.slice();
  let i = 0;
  while (i < chars.length) {
    if (!isDigit(chars[i]) && !isLookalike(chars[i]) && !isSep(chars[i])) {
      i++;
      continue;
    }
    let j = i;
    let nonSep = 0;
    let real = 0;
    while (j < chars.length && (isDigit(chars[j]) || isLookalike(chars[j]) || isSep(chars[j]))) {
      if (!isSep(chars[j])) {
        nonSep++;
        if (isDigit(chars[j])) real++;
      }
      j++;
    }
    if (nonSep > 0 && real * 2 >= nonSep) {
      for (let k = i; k < j; k++) if (isLookalike(chars[k])) out[k] = LOOKALIKE[chars[k]];
    }
    i = j;
  }
  return out.join("");
}

// a lookalike becomes a digit only when both its nearest non-separator neighbours are digit or lookalike
function interiorVariant(text: string): string {
  const chars = [...text];
  const out = chars.slice();
  for (let i = 0; i < chars.length; i++) {
    if (!isLookalike(chars[i])) continue;
    let l = i - 1;
    while (l >= 0 && isSep(chars[l])) l--;
    let r = i + 1;
    while (r < chars.length && isSep(chars[r])) r++;
    const leftOk = l >= 0 && (isDigit(chars[l]) || isLookalike(chars[l]));
    const rightOk = r < chars.length && (isDigit(chars[r]) || isLookalike(chars[r]));
    if (leftOk && rightOk) out[i] = LOOKALIKE[chars[i]];
  }
  return out.join("");
}

interface Span {
  start: number;
  end: number;
  word: OcrWord;
}

// words joined by a single space, each word's character range recorded for later
function buildLine(words: OcrWord[]): { raw: string; spans: Span[] } {
  let text = "";
  const spans: Span[] = [];
  for (const w of words) {
    if (text) text += " ";
    const start = text.length;
    text += w.text;
    spans.push({ start, end: text.length, word: w });
  }
  return { raw: text, spans };
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const rectsOverlap = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

// merge overlapping or identical rects until none are left touching
function mergeRects(rects: Rect[]): Rect[] {
  let merged = rects.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length && !changed; i++) {
      for (let j = i + 1; j < merged.length && !changed; j++) {
        if (!rectsOverlap(merged[i], merged[j])) continue;
        const a = merged[i];
        const b = merged[j];
        const combined: Rect = {
          x0: Math.min(a.x0, b.x0),
          y0: Math.min(a.y0, b.y0),
          x1: Math.max(a.x1, b.x1),
          y1: Math.max(a.y1, b.y1),
        };
        merged = merged.filter((_, k) => k !== i && k !== j);
        merged.push(combined);
        changed = true;
      }
    }
  }
  return merged;
}

export function findIcBoxes(lines: OcrLine[], pad = PAD): Box[] {
  const boxes: Box[] = [];
  // an ic split across two ocr lines isn't joined, each line is matched alone
  for (const line of lines) {
    const { raw, spans } = buildLine(line.words);
    const rects: Rect[] = [];
    for (const text of [raw, allVariant(raw), interiorVariant(raw)]) {
      for (const m of text.matchAll(IMAGE_IC)) {
        const from = m.index ?? 0;
        const to = from + m[0].length;
        const hit = spans.filter((s) => s.start < to && s.end > from).map((s) => s.word.bbox);
        if (!hit.length) continue;
        rects.push({
          x0: Math.min(...hit.map((b) => b.x0)),
          y0: Math.min(...hit.map((b) => b.y0)),
          x1: Math.max(...hit.map((b) => b.x1)),
          y1: Math.max(...hit.map((b) => b.y1)),
        });
      }
    }
    for (const r of mergeRects(rects)) {
      boxes.push({ x: r.x0 - pad, y: r.y0 - pad, w: r.x1 - r.x0 + 2 * pad, h: r.y1 - r.y0 + 2 * pad });
    }
  }
  return boxes;
}

export function needsCheck(result: OcrResult): boolean {
  const words = result.lines.flatMap((l) => l.words);
  if (!words.length) return false;
  // fail closed: a missing or NaN confidence counts as low
  if (!(result.confidence >= MIN_PAGE_CONFIDENCE)) return true;
  for (const line of result.lines) {
    const { raw, spans } = buildLine(line.words);
    const all = allVariant(raw);
    for (const s of spans) {
      if (digits(all.slice(s.start, s.end)) >= 4 && s.word.confidence < MIN_NUMBER_CONFIDENCE) return true;
    }
  }
  return false;
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
