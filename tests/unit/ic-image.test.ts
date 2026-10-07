import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { findIcBoxes, needsCheck, normalizeImage, coverBoxes, isAllowedImage, MAX_PIXELS, type OcrLine } from "@/lib/privacy/ic-image";

let x = 0;
const word = (text: string, confidence = 95, width = 60) => {
  const w = { text, confidence, bbox: { x0: x, y0: 10, x1: x + width, y1: 30 } };
  x += width + 10;
  return w;
};
const line = (...texts: string[]): OcrLine => {
  x = 0;
  return { words: texts.map((t) => word(t)) };
};
// a word is covered when some returned box fully contains its bbox
const coveredBy = (boxes: { x: number; y: number; w: number; h: number }[], bbox: { x0: number; y0: number; x1: number; y1: number }) =>
  boxes.some((b) => bbox.x0 >= b.x && bbox.x1 <= b.x + b.w && bbox.y0 >= b.y && bbox.y1 <= b.y + b.h);

describe("findIcBoxes", () => {
  it("finds an IC written as one word", () => {
    const boxes = findIcBoxes([line("IC:", "900101-14-5678", "thanks")]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toEqual({ x: 70 - 6, y: 10 - 6, w: 60 + 12, h: 20 + 12 });
  });

  it("joins an IC split over three words", () => {
    const boxes = findIcBoxes([line("no", "900101", "14", "5678")]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].x).toBe(70 - 6);
    expect(boxes[0].w).toBe(3 * 60 + 2 * 10 + 12);
  });

  it("reads common OCR mix-ups as digits", () => {
    expect(findIcBoxes([line("9OO1O1-l4-S678")])).toHaveLength(1);
    expect(findIcBoxes([line("900101—14—5678")])).toHaveLength(1);
  });

  it("leaves ordinary words and short numbers alone", () => {
    expect(findIcBoxes([line("Invoice", "12345", "SOLD", "Bill")])).toHaveLength(0);
    expect(findIcBoxes([line("ref", "12345678901234")])).toHaveLength(0);
  });

  it("finds several ICs on several lines", () => {
    expect(findIcBoxes([line("900101145678"), line("a", "850505-10-1234")])).toHaveLength(2);
  });

  it.each([
    ["|900101-14-5678", "leading pipe"],
    ["|900101-14-5678|", "leading and trailing pipe"],
    ["900101-14-5678l", "trailing l"],
    ["900101145678s", "trailing s, no separators"],
    ["ID900101145678", "ID label glued on"],
    ["NO900101145678", "NO label glued on"],
    ["900101--14--5678", "doubled dashes"],
    ["MyKad:9OO1O1-14-5678", "label glued on with lookalikes"],
    ["|9OO1O1-14-5678", "leading pipe with lookalikes"],
    ["900101/14/5678", "slash separators"],
    ["900101_14_5678", "underscore separators"],
    ["900101,14,5678", "comma separators"],
    ["g00101-14-5678", "g read as 9"],
    ["q00101-14-5678", "q read as 9"],
    ["900101:14:5678", "colon separators"],
    ["900101-14-567T", "T read as 7"],
    ["|l9OO1O1-14-5678", "two stacked leading lookalikes"],
    ["IS9OO1O1-14-5678", "label letters that are themselves lookalikes"],
  ])("finds an IC glued or disguised as %s (%s)", (text) => {
    expect(findIcBoxes([line(text)])).toHaveLength(1);
  });

  it.each([
    [["900101-14", "-5678"], "split after the two-digit group"],
    [["900101-", "14-5678"], "split before the two-digit group"],
    [["900101", "-", "14", "-", "5678"], "every group and separator its own word"],
    [["9001", "01-14-5678"], "split inside the six-digit group"],
    [["900101", "14", "56", "78"], "split inside the four-digit group"],
    [["900101", "--", "14", "--", "5678"], "doubled dash words either side"],
    [["900101", "-", "-", "14", "5678"], "lone dash words either side"],
  ])("finds an IC split as %s (%s)", (words) => {
    const l = line(...words);
    const boxes = findIcBoxes([l]);
    expect(boxes).toHaveLength(1);
    for (const w of l.words) expect(coveredBy(boxes, w.bbox)).toBe(true);
  });

  it("covers every word of a split IC even when a short number sits right before it", () => {
    const l = line("12", "900101", "14", "56", "78");
    const boxes = findIcBoxes([l]);
    for (const w of l.words.slice(1)) expect(coveredBy(boxes, w.bbox)).toBe(true);
  });

  it.each([
    ["2026-10-08", "a date"],
    ["1234567890123", "a 13-digit reference number"],
    ["INV-2026-000123", "an invoice number"],
  ])("leaves %s alone (%s)", (text) => {
    expect(findIcBoxes([line(text)])).toHaveLength(0);
  });

  it("leaves a mobile number alone", () => {
    expect(findIcBoxes([line("012-345", "6789")])).toHaveLength(0);
  });

  it("leaves an international mobile number alone", () => {
    expect(findIcBoxes([line("+60", "12", "345", "6789")])).toHaveLength(0);
  });

  it("leaves an ordinary sentence alone", () => {
    expect(findIcBoxes([line("Please", "reset", "my", "password", "today")])).toHaveLength(0);
  });
});

describe("needsCheck", () => {
  const ok = { confidence: 90, lines: [line("hello", "900101-14-5678")] };
  it("passes a clear image", () => {
    expect(needsCheck(ok)).toBe(false);
  });
  it("flags low overall confidence", () => {
    expect(needsCheck({ ...ok, confidence: 60 })).toBe(true);
  });
  it("flags an unsure number", () => {
    x = 0;
    expect(needsCheck({ confidence: 90, lines: [{ words: [word("90010114", 70)] }] })).toBe(true);
  });
  it("an image with no text is fine", () => {
    expect(needsCheck({ confidence: 0, lines: [] })).toBe(false);
  });
  it("fails closed on a missing confidence", () => {
    expect(needsCheck({ confidence: NaN, lines: [line("hello")] })).toBe(true);
  });
  it("flags a low-confidence lookalike number hiding near a real one", () => {
    x = 0;
    const words = [word("900101-14-5678"), word("OlOl", 70)];
    expect(needsCheck({ confidence: 90, lines: [{ words }] })).toBe(true);
  });
  it.each([
    ["OlOl", 50, "a standalone lookalike number"],
    ["SOOlOl-l4-S67B", 50, "a lookalike-heavy ic shape"],
    ["900101", NaN, "a missing word confidence"],
  ])("flags %s at confidence %s (%s)", (text, confidence) => {
    x = 0;
    expect(needsCheck({ confidence: 90, lines: [{ words: [word(text, confidence)] }] })).toBe(true);
  });
});

describe("images", () => {
  const red = () => sharp({ create: { width: 100, height: 50, channels: 3, background: "#ff0000" } }).jpeg().toBuffer();
  const redPng = () => sharp({ create: { width: 100, height: 50, channels: 3, background: "#ff0000" } }).png().toBuffer();

  it("normalises to png and reports the size", async () => {
    const n = await normalizeImage(await red());
    expect((await sharp(n.png).metadata()).format).toBe("png");
    expect([n.width, n.height]).toEqual([100, 50]);
  });

  it("covers a box in black", async () => {
    const { png } = await normalizeImage(await redPng());
    const out = await coverBoxes(png, [{ x: 10, y: 10, w: 20, h: 10 }]);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const at = (px: number, py: number) => Array.from(data.subarray((py * info.width + px) * info.channels, (py * info.width + px) * info.channels + 3));
    expect(at(15, 15)).toEqual([0, 0, 0]);
    expect(at(50, 30)).toEqual([255, 0, 0]);
  });

  it("clips boxes to the image", async () => {
    const { png } = await normalizeImage(await redPng());
    const out = await coverBoxes(png, [{ x: 90, y: 40, w: 50, h: 50 }]);
    expect(out).toBeInstanceOf(Buffer);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    const at = (px: number, py: number) => Array.from(data.subarray((py * info.width + px) * info.channels, (py * info.width + px) * info.channels + 3));
    expect(at(99, 49)).toEqual([0, 0, 0]);
  });

  it("only allows png, jpeg and webp", async () => {
    expect(await isAllowedImage(await red())).toBe(true);
    expect(await isAllowedImage(Buffer.from("%PDF-1.4 not an image"))).toBe(false);
    const gif = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).gif().toBuffer();
    expect(await isAllowedImage(gif)).toBe(false);
  });

  describe("pixel limit", () => {
    // 50 megapixels of one colour compresses to almost nothing
    const huge = () => sharp({ create: { width: 10000, height: 5000, channels: 3, background: "#fff" } }).png().toBuffer();

    it("is 40 megapixels", () => {
      expect(MAX_PIXELS).toBe(40_000_000);
    });

    it("refuses an image over the limit", async () => {
      expect(await isAllowedImage(await huge())).toBe(false);
    }, 30_000);

    it("takes an image right at a smaller limit", async () => {
      expect(await isAllowedImage(await red(), 5000)).toBe(true);
      expect(await isAllowedImage(await red(), 4999)).toBe(false);
    });

    it("normalizeImage throws over the limit", async () => {
      await expect(normalizeImage(await huge())).rejects.toThrow(/pixel limit/i);
      await expect(normalizeImage(await red(), 4999)).rejects.toThrow(/pixel limit/i);
    }, 30_000);
  });
});
