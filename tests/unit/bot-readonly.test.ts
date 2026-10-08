import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// every method client.ts may call; whatsapp ones are read-only listeners and getters
const ALLOWED = new Set([
  // whatsapp-web.js
  "on",
  "initialize",
  "logout",
  "destroy",
  "close",
  "getChat",
  "getContact",
  "getQuotedMessage",
  "downloadMedia",
  // our StartTimeoutError, never called on a whatsapp object
  "constructor",
  // our own hooks
  "onQr",
  "onReady",
  "onDown",
  "onMessage",
  // helpers
  "toDataURL",
  "error",
  "from",
  "alloc",
  "has",
  "test",
  "endsWith",
  "startsWith",
  "split",
  "trim",
  "catch",
  "then",
  "finally",
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|js|mjs|cjs)$/.test(p) ? [p] : [];
  });
}

// every method whatsapp-web.js declares on the objects the bot can reach
function libraryMethods(): string[] {
  const lines = readFileSync("node_modules/whatsapp-web.js/index.d.ts", "utf8").split(/\r?\n/);
  const names = new Set<string>();
  let inside = false;
  for (const line of lines) {
    if (/^ {4}export (class|interface) (Client|Message|Chat|GroupChat|Contact|Call)\b/.test(line)) inside = true;
    else if (inside && /^ {4}}/.test(line)) inside = false;
    else if (inside) {
      const m = line.match(/^\s+(\w+)\s*(?:<[^>]*>)?\s*\(/) ?? line.match(/^\s+(\w+)\??\s*:\s*\(/);
      if (m) names.add(m[1]);
    }
  }
  return [...names].sort();
}

// a forbidden name anywhere, called, destructured or quoted, fails the check
function forbiddenIn(text: string, names: string[]): string[] {
  return names.filter((name) => !ALLOWED.has(name) && new RegExp(`\\b${name}\\b`).test(text));
}

function calls(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(/\.\s*(\w+)\s*\(|\[\s*["'`](\w+)["'`]\s*\]\s*\(/g)) names.add(m[1] ?? m[2]);
  return [...names].sort();
}

describe("whatsapp bot is read-only", () => {
  const all = [...files("src"), ...files("scripts")];
  const client = readFileSync("src/lib/bot/client.ts", "utf8");

  it("imports whatsapp-web.js in one place only", () => {
    const users = all.filter((f) => readFileSync(f, "utf8").includes("whatsapp-web.js"));
    expect(users.map((f) => f.replace(/\\/g, "/"))).toEqual(["src/lib/bot/client.ts"]);
  });

  it("also scans plain js scripts", () => {
    expect(all.some((f) => f.endsWith(".mjs"))).toBe(true);
  });

  it("only calls allowed methods", () => {
    expect(calls(client).filter((name) => !ALLOWED.has(name))).toEqual([]);
  });

  it("finds calls written either way", () => {
    expect(calls(`a.sendMessage(x); b["reply"](y); c ?. sendSeen ()`)).toEqual(["reply", "sendMessage", "sendSeen"]);
  });

  it("names no whatsapp-web.js method outside the allowlist", () => {
    const methods = libraryMethods();
    expect(methods).toEqual(expect.arrayContaining(["sendMessage", "reply", "sendSeen", "react", "addParticipants", "getChat"]));
    expect(forbiddenIn(client, methods)).toEqual([]);
  });

  it("catches optional calls and destructuring", () => {
    const methods = libraryMethods();
    expect(forbiddenIn("client.sendMessage?.(x)", methods)).toEqual(["sendMessage"]);
    expect(forbiddenIn("const { sendSeen: s } = chat; s()", methods)).toEqual(["sendSeen"]);
    expect(forbiddenIn("const { getChat } = message", methods)).toEqual([]);
  });

  it("never reaches into the page", () => {
    expect(client).not.toMatch(/\bevaluate\b|\bpupPage\b/);
  });

  it("the old client is gone", () => {
    expect(all.some((f) => f.replace(/\\/g, "/").endsWith("src/lib/channels/whatsapp.ts"))).toBe(false);
  });
});
