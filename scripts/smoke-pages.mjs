// opens every dashboard page in chrome and fails on runtime errors.
// needs the dev server running: npm run dev
import puppeteer from "puppeteer";

const BASE = process.env.SMOKE_URL || "http://localhost:3000";
const USER = process.env.SMOKE_USER || "admin";
const PASS = process.env.SMOKE_PASS || "admin123";

const PAGES = [
  "/", "/conversations", "/customers", "/tickets", "/projects", "/knowledge",
  "/knowledge/test", "/canned-responses", "/automation", "/business-hours",
  "/team", "/sla", "/closing", "/privacy", "/channels", "/webhooks", "/email-log", "/analytics", "/activity",
  "/admin", "/api-docs", "/settings", "/more",
  ...(process.env.SMOKE_EXTRA ? process.env.SMOKE_EXTRA.split(",") : []),
];

const browser = await puppeteer.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const errors = [];

page.on("pageerror", (e) => errors.push(`${page.url()} -> ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && /TypeError|is not a function|Cannot read/.test(m.text())) {
    errors.push(`${page.url()} -> ${m.text()}`);
  }
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
const status = await page.evaluate(
  async (u, p) => {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", username: u, password: p }),
    });
    return res.status;
  },
  USER,
  PASS
);
if (status !== 200) {
  console.error(`login failed (${status})`);
  process.exit(1);
}

for (const path of PAGES) {
  await page.goto(BASE + path, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 500));
  console.log("visited", path);
}

await browser.close();

if (errors.length) {
  console.error("\nruntime errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log("no runtime errors");
