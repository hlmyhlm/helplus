import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WRITES = /\.(sendMessage|reply|sendSeen|sendStateTyping|sendStateRecording|react|forward|sendMediaMessage|setStatus|createGroup|addParticipants|leave)\s*\(/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

describe("whatsapp bot is read-only", () => {
  const all = [...files("src"), ...files("scripts")];

  it("imports whatsapp-web.js in one place only", () => {
    const users = all.filter((f) => readFileSync(f, "utf8").includes("whatsapp-web.js"));
    expect(users.map((f) => f.replace(/\\/g, "/"))).toEqual(["src/lib/bot/client.ts"]);
  });

  it("never calls a whatsapp write method", () => {
    const text = readFileSync("src/lib/bot/client.ts", "utf8");
    expect(text).not.toMatch(WRITES);
  });

  it("the old client is gone", () => {
    expect(all.some((f) => f.replace(/\\/g, "/").endsWith("src/lib/channels/whatsapp.ts"))).toBe(false);
  });
});
