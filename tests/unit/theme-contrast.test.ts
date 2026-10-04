import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector + " {");
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--helplus-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const PAIRS: [string, string][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["text-light", "bg"],
  ["text-light", "surface"],
  ["link", "bg"],
  ["link", "surface"],
  ["link", "primary-50"],
  ["#FFFFFF", "primary"],
  ["danger", "surface"],
  ["success", "surface"],
  ["warning", "surface"],
];

for (const [name, selector] of [["light", ":root"], ["dark", ".dark"]] as const) {
  describe(`${name} theme contrast`, () => {
    const t = tokens(selector);
    it.each(PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
      const a = fg.startsWith("#") ? fg : t[fg];
      const b = t[bg];
      expect(a, `missing --helplus-${fg}`).toBeDefined();
      expect(b, `missing --helplus-${bg}`).toBeDefined();
      expect(contrast(a, b)).toBeGreaterThanOrEqual(4.5);
    });
  });
}
