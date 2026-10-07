import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { generateToken } from "@/lib/auth";

const A = "it-3b-api-a";
const B = "it-3b-api-b";
const ADMIN = "it-3b-api-admin";
let otherJob: string;
let token: string;

function req(path: string, method = "GET") {
  const r = new NextRequest(new URL(path, "http://localhost:3000"), {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? "{}" : undefined,
  });
  r.cookies.set("helplus-token", token);
  return r;
}

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.create({ data: { id: A, name: "A", slug: A } });
  await systemPrisma.company.create({ data: { id: B, name: "B", slug: B } });
  await runWithCompany(A, () => prisma.admin.create({ data: { id: ADMIN, username: ADMIN, password: "x", role: "admin" } }));
  otherJob = await runWithCompany(B, async () => {
    const project = await prisma.project.create({ data: { name: "General", isDefault: true } });
    const job = await prisma.importJob.create({ data: { projectId: project.id, kind: "csv", status: "uploaded" } });
    return job.id;
  });
  token = generateToken(ADMIN, "admin");
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("imports api across companies", () => {
  const ctx = () => ({ params: Promise.resolve({ id: otherJob }) });

  it("hides another company's job", async () => {
    const { GET } = await import("@/app/api/imports/[id]/route");
    expect((await GET(req(`/api/imports/${otherJob}`), ctx())).status).toBe(404);
  });

  it("won't start another company's job", async () => {
    const { POST } = await import("@/app/api/imports/[id]/start/route");
    expect((await POST(req(`/api/imports/${otherJob}/start`, "POST"), ctx())).status).toBe(404);
    const job = await systemPrisma.importJob.findUniqueOrThrow({ where: { id: otherJob } });
    expect(job.status).toBe("uploaded");
  });

  it("won't hand out another company's bad rows", async () => {
    const { GET } = await import("@/app/api/imports/[id]/bad-rows/route");
    expect((await GET(req(`/api/imports/${otherJob}/bad-rows`), ctx())).status).toBe(404);
  });

  it("leaves it out of the list", async () => {
    const { GET } = await import("@/app/api/imports/route");
    const res = await GET(req("/api/imports"), {} as never);
    const body = await res.json();
    expect(body.data.map((j: { id: string }) => j.id)).not.toContain(otherJob);
  });
});
