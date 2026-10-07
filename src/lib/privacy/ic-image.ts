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
// a tiny file can still decode to a huge bitmap
export const MAX_PIXELS = 40_000_000;

// chars allowed between or inside ic groups: space, dashes, dot, tilde, slash, comma, underscore, colon
const SEP_CLASS = String.raw`\s\-–—.~/,_:`;
const SEP_RE = new RegExp(`[${SEP_CLASS}]`);
// a colon is usually a label's trailing punctuation, so expansion doesn't cross it like other separators
const EXPAND_SEP_RE = new RegExp(String.raw`[\s\-–—.~/,_]`);
// six digits, 0-5 separators, two digits, 0-5 separators, four digits; one space may sit inside a group
const IMAGE_IC_SRC = String.raw`(?<!\d)\d(?:\s?\d){5}[${SEP_CLASS}]{0,5}\d\s?\d[${SEP_CLASS}]{0,5}\d(?:\s?\d){3}(?!\d)`;
// zero-width lookahead so every starting position is tried, not just the leftmost non-overlapping match
const IMAGE_IC_OVERLAP = new RegExp(`(?=(${IMAGE_IC_SRC}))`, "g");
const LOOKALIKE: Record<string, string> = {
  O: "0", o: "0", D: "0", I: "1", l: "1", "|": "1", S: "5", s: "5", B: "8", Z: "2", g: "9", q: "9", T: "7",
};

const isDigit = (c: string) => c >= "0" && c <= "9";
const isLookalike = (c: string) => LOOKALIKE[c] !== undefined;
const isSep = (c: string) => SEP_RE.test(c);
const isRunChar = (c: string) => isDigit(c) || isLookalike(c) || isSep(c);

interface Run {
  start: number;
  end: number;
  firstDigit: number;
  lastDigit: number;
  qualifies: boolean;
}

function scanRuns(chars: string[]): Run[] {
  const runs: Run[] = [];
  let i = 0;
  while (i < chars.length) {
    if (!isRunChar(chars[i])) {
      i++;
      continue;
    }
    let j = i;
    let nonSep = 0;
    let real = 0;
    let firstDigit = -1;
    let lastDigit = -1;
    while (j < chars.length && isRunChar(chars[j])) {
      if (!isSep(chars[j])) {
        nonSep++;
        if (isDigit(chars[j])) {
          real++;
          if (firstDigit === -1) firstDigit = j;
          lastDigit = j;
        }
      }
      j++;
    }
    runs.push({ start: i, end: j, firstDigit, lastDigit, qualifies: nonSep > 0 && real * 2 >= nonSep });
    i = j;
  }
  return runs;
}

// a lookalike becomes a digit when its run is at least half real digits already
function allVariant(text: string): string {
  const chars = [...text];
  const out = chars.slice();
  for (const r of scanRuns(chars)) {
    if (!r.qualifies) continue;
    for (let k = r.start; k < r.end; k++) if (isLookalike(chars[k])) out[k] = LOOKALIKE[chars[k]];
  }
  return out.join("");
}

// like all, but a run's leading and trailing lookalikes stay as they are, outside its real digits
function trimmedVariant(text: string): string {
  const chars = [...text];
  const out = chars.slice();
  for (const r of scanRuns(chars)) {
    if (!r.qualifies || r.firstDigit === -1) continue;
    for (let k = r.firstDigit; k <= r.lastDigit; k++) if (isLookalike(chars[k])) out[k] = LOOKALIKE[chars[k]];
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

// a lookalike letter is already resolved by the variant, so expansion only chases digits and separators
const isExpandChar = (c: string) => isDigit(c) || EXPAND_SEP_RE.test(c);

// widen on the raw text, so a converted lookalike can't pull in the next word
function expandRun(raw: string, from: number, to: number): { from: number; to: number } {
  let a = from;
  while (a > 0 && isExpandChar(raw[a - 1])) a--;
  let b = to;
  while (b < raw.length && isExpandChar(raw[b])) b++;
  return { from: a, to: b };
}

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
    for (const text of [raw, allVariant(raw), interiorVariant(raw), trimmedVariant(raw)]) {
      for (const m of text.matchAll(IMAGE_IC_OVERLAP)) {
        const matched = m[1];
        if (!matched) continue;
        const start = m.index ?? 0;
        const { from, to } = expandRun(raw, start, start + matched.length);
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

const digitish = (t: string) => [...t].filter((c) => isDigit(c) || isLookalike(c)).length;

export function needsCheck(result: OcrResult): boolean {
  const words = result.lines.flatMap((l) => l.words);
  if (!words.length) return false;
  // fail closed: a missing or NaN page confidence counts as low
  if (!(result.confidence >= MIN_PAGE_CONFIDENCE)) return true;
  // fail closed on word confidence too, and count digits and lookalikes together
  return words.some((w) => digitish(w.text) >= 4 && !(w.confidence >= MIN_NUMBER_CONFIDENCE));
}

// rotate by exif, drop metadata, png so box coordinates always match
export async function normalizeImage(data: Buffer, maxPixels = MAX_PIXELS): Promise<{ png: Buffer; width: number; height: number }> {
  const { data: png, info } = await sharp(data, { limitInputPixels: maxPixels }).rotate().png().toBuffer({ resolveWithObject: true });
  return { png, width: info.width, height: info.height };
}

export async function coverBoxes(png: Buffer, boxes: Box[]): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(png, { limitInputPixels: MAX_PIXELS }).metadata();
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
  return sharp(png, { limitInputPixels: MAX_PIXELS }).composite(layers).png().toBuffer();
}

export async function isAllowedImage(data: Buffer, maxPixels = MAX_PIXELS): Promise<boolean> {
  try {
    const { format, width = 0, height = 0 } = await sharp(data, { limitInputPixels: maxPixels }).metadata();
    return !!format && ALLOWED.has(format) && width > 0 && width * height <= maxPixels;
  } catch {
    return false;
  }
}
