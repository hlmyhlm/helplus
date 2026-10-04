import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
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
  ["link", "primary-100"],
  ["#FFFFFF", "primary"],
  ["danger", "surface"],
  ["success", "surface"],
  ["warning", "surface"],
  ["danger", "bg"],
  ["success", "bg"],
  ["warning", "bg"],
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

// Guard: every text-helplus-* class in src must use a token that is
// actually contrast-tested above. Anything else (e.g. text-helplus-primary-dark,
// text-helplus-border) risks failing 4.5:1 in one of the themes since it has
// no PAIRS coverage.
const ALLOWED_TEXT_TOKENS = new Set([
  "text",
  "text-light",
  "link",
  "danger",
  "success",
  "warning",
]);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "generated") continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(tsx|ts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("text-helplus-* token usage", () => {
  const srcDir = path.resolve(__dirname, "../../src");
  const files = collectSourceFiles(srcDir);

  it("only uses contrast-tested tokens as a text colour", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const m of content.matchAll(/text-helplus-([a-z0-9-]+)/g)) {
        const token = m[1];
        if (!ALLOWED_TEXT_TOKENS.has(token)) {
          offenders.push(`${path.relative(srcDir, file)}: text-helplus-${token}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  // text-helplus-x/60 fades a tested colour below 4.5:1. Exempt: placeholders,
  // decorative icon components (<Icon className=... />) and disabled controls,
  // which WCAG doesn't hold to the text ratio.
  it("doesn't fade text colours with an opacity suffix", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/(\S*?)text-helplus-[a-z0-9-]+\/\d+/g)) {
          if (m[1].endsWith("placeholder:")) continue;
          if (/<[A-Z]\w*\s+className=.*\/>/.test(line)) continue;
          if (line.includes("cursor-not-allowed")) continue;
          offenders.push(`${path.relative(srcDir, file)}:${i + 1}: ${m[0]}`);
        }
      });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
