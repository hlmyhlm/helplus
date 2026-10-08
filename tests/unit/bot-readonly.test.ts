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
  "split",
  "trim",
  "catch",
  "then",
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
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

  it("only calls allowed methods", () => {
    expect(calls(client).filter((name) => !ALLOWED.has(name))).toEqual([]);
  });

  it("finds calls written either way", () => {
    expect(calls(`a.sendMessage(x); b["reply"](y); c ?. sendSeen ()`)).toEqual(["reply", "sendMessage", "sendSeen"]);
  });

  it("never reaches into the page", () => {
    expect(client).not.toMatch(/\bevaluate\b|\bpupPage\b/);
  });

  it("the old client is gone", () => {
    expect(all.some((f) => f.replace(/\\/g, "/").endsWith("src/lib/channels/whatsapp.ts"))).toBe(false);
  });
});
