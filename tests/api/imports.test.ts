import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { fileStore } from "@/lib/storage";
import { createRequest, parseJsonResponse } from "../helpers/request";

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  fileStore: vi.fn(),
}));

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const store = { get: vi.fn(), put: vi.fn(), remove: vi.fn() };
const idCtx = { params: Promise.resolve({ id: "j1" }) };

const asRole = (role: string) =>
  vi.mocked(requireAuth).mockResolvedValue({
    userId: "u1",
    role,
    username: "u",
    name: "U",
    authMethod: "cookie",
    companyId: "test-company",
  } as never);

function upload(fields: Record<string, string>, file: { name: string; text: string } | null, contentLength?: number | null) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append("file", new File([file.text], file.name, { type: "text/plain" }));
  const headers: Record<string, string> = {};
  if (contentLength !== null) headers["content-length"] = String(contentLength ?? (file?.text.length ?? 0) + 500);
  return new NextRequest(new URL("/api/imports", "http://localhost:3000"), { method: "POST", body: fd, headers });
}

const csvText = (n: number) =>
  ["Ticket ID,Question,Answer", ...Array.from({ length: n }, (_, i) => `T${i},Question ${i},Answer ${i}`)].join("\n");

beforeEach(() => {
  for (const m of ["importJob", "project", "projectAccess", "importMapping", "chatSender", "teamMember", "admin"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  store.get.mockReset();
  store.put.mockReset().mockResolvedValue(undefined);
  store.remove.mockReset();
  vi.mocked(fileStore).mockReturnValue(store as never);
  vi.mocked(requireAuth).mockReset();
  asRole("admin");
  db.project.findFirst.mockResolvedValue({ archived: false });
  db.importMapping.findFirst.mockResolvedValue(null);
  db.chatSender.findMany.mockResolvedValue([]);
  db.teamMember.findMany.mockResolvedValue([]);
  db.admin.findMany.mockResolvedValue([]);
  db.importJob.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
});

describe("POST /api/imports", () => {
  it("asks for imports:run", async () => {
    const { POST } = await import("@/app/api/imports/route");
    await POST(upload({ projectId: "p1", kind: "csv" }, { name: "a.csv", text: csvText(1) }), {} as never);
    expect(vi.mocked(requireAuth).mock.calls[0][1]).toBe("imports:run");
  });

  it("returns 411 without a Content-Length", async () => {
    const { POST } = await import("@/app/api/imports/route");
    const res = await POST(upload({ projectId: "p1", kind: "csv" }, { name: "a.csv", text: csvText(1) }, null), {} as never);
    expect(res.status).toBe(411);
  });

  it("returns 413 over 50 MB", async () => {
    const { POST } = await import("@/app/api/imports/route");
    const res = await POST(upload({ projectId: "p1", kind: "csv" }, { name: "a.csv", text: csvText(1) }, 50 * 1024 * 1024 + 1), {} as never);
    expect(res.status).toBe(413);
  });

  it("returns 403 for a project the user can't see", async () => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "other" }]);
    const { POST } = await import("@/app/api/imports/route");
    const res = await POST(upload({ projectId: "p1", kind: "csv" }, { name: "a.csv", text: csvText(1) }), {} as never);
    expect(res.status).toBe(403);
    expect(store.put).not.toHaveBeenCalled();
  });

  it("refuses an archived project", async () => {
    db.project.findFirst.mockResolvedValue({ archived: true });
    const { POST } = await import("@/app/api/imports/route");
    const res = await POST(upload({ projectId: "p1", kind: "csv" }, { name: "a.csv", text: csvText(1) }), {} as never);
    expect(res.status).toBe(400);
  });

  it("previews at most 20 csv rows and stores the file encrypted", async () => {
    const { POST } = await import("@/app/api/imports/route");
    const text = csvText(30);
    const res = await POST(upload({ projectId: "p1", kind: "csv" }, { name: "a.csv", text }), {} as never);
    expect(res.status).toBe(201);
    const body = await parseJsonResponse(res);
    expect(body.kind).toBe("csv");
    expect(body.preview.rows).toHaveLength(20);
    expect(body.preview.good).toBe(30);
    expect(body.preview.mapping).toMatchObject({ oldId: "Ticket ID", question: "Question" });
    const [key, bytes] = store.put.mock.calls[0];
    expect(key).toBe(`c/test-company/imports/${body.id}.bin`);
    expect(Buffer.from(bytes).toString("utf8")).not.toContain("Question 1");
    const created = db.importJob.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ status: "uploaded", projectId: "p1", createdById: "u1", fileKey: key });
  });

  it("previews a whatsapp chat with staff ticked from the team", async () => {
    db.teamMember.findMany.mockResolvedValue([{ name: "Support Ali", phone: "" }]);
    const chat = [
      "12/10/2026, 9:06 am - Aminah: IC saya 900101-14-5678 tolong",
      "12/10/2026, 9:30 am - Support Ali: Cuba clear cache",
    ].join("\n");
    const { POST } = await import("@/app/api/imports/route");
    const res = await POST(upload({ projectId: "p1", kind: "whatsapp" }, { name: "chat.txt", text: chat }), {} as never);
    expect(res.status).toBe(201);
    const { preview } = await parseJsonResponse(res);
    expect(preview.senders).toEqual([
      { name: "Aminah", count: 1, isStaff: false },
      { name: "Support Ali", count: 1, isStaff: true },
    ]);
    expect(preview).toMatchObject({ order: "dmy", issues: 1, answered: 1 });
    expect(preview.sample[0].firstLine).not.toContain("900101");
  });

  it("returns 400 for a file that isn't a chat", async () => {
    const { POST } = await import("@/app/api/imports/route");
    const res = await POST(upload({ projectId: "p1", kind: "whatsapp" }, { name: "x.txt", text: "hello there" }), {} as never);
    expect(res.status).toBe(400);
    expect((await parseJsonResponse(res)).error).toBe("This isn't a WhatsApp export");
  });
});

describe("POST /api/imports/:id/start", () => {
  const start = (body: Record<string, unknown>) => createRequest("/api/imports/j1/start", { method: "POST", body });

  it("returns 409 when the job isn't waiting to start", async () => {
    db.importJob.findFirst.mockResolvedValue({ id: "j1", kind: "csv", status: "queued", options: {}, preview: {} });
    const { POST } = await import("@/app/api/imports/[id]/start/route");
    const res = await POST(start({}), idCtx);
    expect(res.status).toBe(409);
  });

  it("returns 400 for csv without an ID column", async () => {
    db.importJob.findFirst.mockResolvedValue({
      id: "j1",
      kind: "csv",
      status: "uploaded",
      options: {},
      preview: { headers: ["Question"], mapping: {} },
    });
    const { POST } = await import("@/app/api/imports/[id]/start/route");
    const res = await POST(start({ mapping: { question: "Question" } }), idCtx);
    expect(res.status).toBe(400);
    expect(db.importJob.updateMany).not.toHaveBeenCalled();
  });

  it("queues a whatsapp job and remembers the staff picks", async () => {
    db.importJob.findFirst.mockResolvedValue({
      id: "j1",
      kind: "whatsapp",
      status: "uploaded",
      options: { order: "dmy" },
      preview: { senders: [{ name: "Aminah" }, { name: "Support Ali" }] },
    });
    db.importJob.updateMany.mockResolvedValue({ count: 1 });
    const { POST } = await import("@/app/api/imports/[id]/start/route");
    const res = await POST(start({ staff: ["Support Ali"], order: "mdy" }), idCtx);
    expect(res.status).toBe(200);
    const upserts = db.chatSender.upsert.mock.calls.map((c) => c[0].create);
    expect(upserts).toEqual([
      { name: "Aminah", isStaff: false },
      { name: "Support Ali", isStaff: true },
    ]);
    expect(db.importJob.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "j1", status: "uploaded" },
      data: { status: "queued", options: { order: "mdy", staff: ["Support Ali"] } },
    });
  });
});

describe("GET /api/imports/:id/bad-rows", () => {
  it("downloads the bad rows as csv", async () => {
    db.importJob.findFirst.mockResolvedValue({
      id: "j1",
      badRows: [{ line: 3, reason: "Missing ID", raw: { "Ticket ID": "", Question: "Help" } }],
    });
    const { GET } = await import("@/app/api/imports/[id]/bad-rows/route");
    const res = await GET(createRequest("/api/imports/j1/bad-rows"), idCtx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="bad-rows.csv"');
    expect(await res.text()).toContain("Missing ID");
  });

  it("returns 404 for an unknown job", async () => {
    db.importJob.findFirst.mockResolvedValue(null);
    const { GET } = await import("@/app/api/imports/[id]/bad-rows/route");
    const res = await GET(createRequest("/api/imports/j1/bad-rows"), idCtx);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/imports", () => {
  it("lists the newest 20 jobs without file details", async () => {
    db.importJob.findMany.mockResolvedValue([]);
    const { GET } = await import("@/app/api/imports/route");
    const res = await GET(createRequest("/api/imports"), {} as never);
    expect(res.status).toBe(200);
    const args = db.importJob.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ orderBy: { createdAt: "desc" }, take: 20 });
    expect(args.select.fileKey).toBeUndefined();
  });
});
