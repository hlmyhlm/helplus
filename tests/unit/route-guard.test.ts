import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const API = path.resolve(__dirname, "../../src/app/api");

const PUBLIC = new Set([
  "auth/route.ts",
  "health/route.ts",
  "openapi.json/route.ts",
  "channels/phone/incoming/route.ts",
  "channels/phone/gather/route.ts",
  "channels/phone/status/route.ts",
  "channels/sms/route.ts",
  "channels/telegram/route.ts",
]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return name === "route.ts" ? [full] : [];
  });
}

const files = routeFiles(API).map((f) => path.relative(API, f).split(path.sep).join("/"));

describe("api routes", () => {
  it("found the route files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files.filter((f) => !PUBLIC.has(f)))("%s uses withAuth for every handler", (file) => {
    const src = readFileSync(path.join(API, file), "utf8");
    expect(src, "plain exported handler found").not.toMatch(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/);
    expect(src, "requireAuth used directly").not.toMatch(/\brequireAuth\(/);
    expect(src).toMatch(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*=\s*withAuth\(/);
  });
});
