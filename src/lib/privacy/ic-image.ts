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

// ocr separators are messier than typed text, so allow dashes and dots between groups
const IMAGE_IC = /(?<!\d)\d{6}[\s\-–—.~]?\d{2}[\s\-–—.~]?\d{4}(?!\d)/g;
const LOOKALIKE: Record<string, string> = { O: "0", o: "0", D: "0", I: "1", l: "1", "|": "1", S: "5", s: "5", B: "8", Z: "2" };

const digits = (t: string) => (t.match(/\d/g) ?? []).length;

// only fix lookalikes in words that are mostly digits, so real words stay words
function asDigits(text: string): string {
  const fixed = [...text].map((c) => LOOKALIKE[c] ?? c).join("");
  return digits(fixed) >= Math.ceil(text.replace(/[\s\-–—.~]/g, "").length * 0.7) ? fixed : text;
}

export function findIcBoxes(lines: OcrLine[], pad = PAD): Box[] {
  const boxes: Box[] = [];
  for (const line of lines) {
    let text = "";
    const spans: { start: number; end: number; word: OcrWord }[] = [];
    for (const w of line.words) {
      if (text) text += " ";
      const start = text.length;
      text += asDigits(w.text);
      spans.push({ start, end: text.length, word: w });
    }
    for (const m of text.matchAll(IMAGE_IC)) {
      const from = m.index ?? 0;
      const to = from + m[0].length;
      const hit = spans.filter((s) => s.start < to && s.end > from).map((s) => s.word.bbox);
      if (!hit.length) continue;
      const x0 = Math.min(...hit.map((b) => b.x0));
      const y0 = Math.min(...hit.map((b) => b.y0));
      const x1 = Math.max(...hit.map((b) => b.x1));
      const y1 = Math.max(...hit.map((b) => b.y1));
      boxes.push({ x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad });
    }
  }
  return boxes;
}

export function needsCheck(result: OcrResult): boolean {
  const words = result.lines.flatMap((l) => l.words);
  if (!words.length) return false;
  if (result.confidence < MIN_PAGE_CONFIDENCE) return true;
  return words.some((w) => digits(w.text) >= 4 && w.confidence < MIN_NUMBER_CONFIDENCE);
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
