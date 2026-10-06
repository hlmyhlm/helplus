import { NextResponse } from "next/server";
import { systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { getSettings } from "@/lib/settings";
import { resolveBaseUrl } from "@/lib/ai/provider";
import { chatConfig, isConfigured } from "@/lib/ai/config";

const startTime = Date.now();

export async function GET() {
  const checks: Record<string, string> = {};

  // Database check
  try {
    await systemPrisma.$queryRaw`SELECT 1`;
    checks.database = "connected";
  } catch {
    checks.database = "error";
  }

  // AI provider reachability. a shared server shouldn't report one company's AI on a public endpoint
  try {
    const companies = await systemPrisma.company.findMany({ select: { id: true }, take: 2 });
    checks.ai = companies.length === 1 ? await runWithCompany(companies[0].id, checkAi) : "not_configured";
  } catch {
    checks.ai = "unreachable";
  }

  // Uptime
  const uptimeMs = Date.now() - startTime;
  const uptimeSeconds = Math.floor(uptimeMs / 1000);
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;

  // Memory
  const mem = process.memoryUsage();

  const allHealthy = Object.values(checks).every(
    (v) => v === "connected" || v === "reachable" || v === "not_configured"
  );

  return NextResponse.json({
    status: allHealthy ? "ok" : "degraded",
    version: process.env.npm_package_version || "0.1.1",
    environment: process.env.NODE_ENV || "development",
    uptime: `${hours}h ${minutes}m ${seconds}s`,
    services: checks,
    memory: {
      rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
      heap: `${Math.round(mem.heapUsed / 1024 / 1024)}/${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
    },
  });
}

async function checkAi(): Promise<string> {
  const ai = chatConfig(await getSettings());
  if (!isConfigured(ai)) return "not_configured";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  const base = resolveBaseUrl(ai) ?? "https://api.openai.com/v1";
  const res = await fetch(`${base.replace(/\/$/, "")}/models`, {
    headers: ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {},
    signal: controller.signal,
  });
  clearTimeout(timeout);
  return res.ok ? "reachable" : "error";
}
