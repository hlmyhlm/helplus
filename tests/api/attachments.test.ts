import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest, parseJsonResponse } from "../helpers/request";
import { addAttachment, MAX_BYTES } from "@/lib/attachments/service";
import { confirmAttachment, remask } from "@/lib/attachments/process";
import { fileStore } from "@/lib/storage";
import { decryptBuffer } from "@/lib/secrets";
import { isAllowedImage, normalizeImage } from "@/lib/privacy/ic-image";

vi.mock("@/lib/attachments/service", () => ({ addAttachment: vi.fn(), MAX_BYTES: 1000 }));
vi.mock("@/lib/attachments/process", () => ({ confirmAttachment: vi.fn(), remask: vi.fn() }));
vi.mock("@/lib/storage", () => ({ fileStore: vi.fn() }));
vi.mock("@/lib/secrets", () => ({ decryptBuffer: vi.fn((b: Buffer) => b) }));
vi.mock("@/lib/privacy/ic-image", () => ({ isAllowedImage: vi.fn(), normalizeImage: vi.fn() }));

const MAX_FILES = 5;
const MAX_UPLOAD_BYTES = MAX_FILES * MAX_BYTES + 1024 * 1024;

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const ctx = { params: Promise.resolve({ id: "a1" }) };
const ticketCtx = { params: Promise.resolve({ id: "t1" }) };

const ticket = { id: "t1", projectId: "p1" };
const baseAttachment = () => ({
  id: "a1",
  ticketId: "t1",
  messageId: null,
  fileName: "s.png",
  status: "clean",
  icCount: 0,
  width: 10,
  height: 10,
  checkNote: "",
  originalKey: "c/co/attachments/a1/original.bin",
  maskedKey: "c/co/attachments/a1/masked.png",
  originalDeletedAt: null,
  createdAt: new Date(),
});

const asRole = (role: string) =>
  vi.mocked(requireAuth).mockResolvedValue({
    userId: "u1",
    role,
    username: "u",
    name: "U",
    authMethod: "cookie",
    companyId: "test-company",
  } as never);

const store = { get: vi.fn(), put: vi.fn(), remove: vi.fn() };

beforeEach(() => {
  for (const m of ["ticket", "attachment", "projectAccess", "activityLog"]) {
    for (const fn of Object.values(db[m])) fn.mockReset();
  }
  vi.mocked(addAttachment).mockReset();
  vi.mocked(confirmAttachment).mockReset();
  vi.mocked(remask).mockReset();
  vi.mocked(isAllowedImage).mockReset().mockResolvedValue(true);
  vi.mocked(normalizeImage).mockReset().mockResolvedValue({ png: Buffer.from("png"), width: 10, height: 10 });
  vi.mocked(decryptBuffer).mockReset().mockImplementation((b: Buffer) => b);
  store.get.mockReset().mockResolvedValue(Buffer.from("bytes"));
  store.put.mockReset();
  store.remove.mockReset();
  vi.mocked(fileStore).mockReturnValue(store as never);
  vi.mocked(requireAuth).mockReset();
  asRole("admin");
  db.ticket.findUnique.mockResolvedValue(ticket);
  db.attachment.findUnique.mockResolvedValue(baseAttachment());
  db.activityLog.create.mockResolvedValue({ id: "log1" });
});

// a real browser always sends Content-Length for a FormData body; tests set it explicitly
// since constructing a Request from FormData directly doesn't compute one.
function multipart(path: string, files: { name: string; bytes: number }[], contentLength?: number | null) {
  const fd = new FormData();
  let total = 0;
  for (const f of files) {
    fd.append("files", new File([Buffer.alloc(f.bytes, 1)], f.name, { type: "image/png" }));
    total += f.bytes + 200; // rough per-part overhead
  }
  const headers: Record<string, string> = {};
  if (contentLength !== null) headers["content-length"] = String(contentLength ?? total);
  return new NextRequest(new URL(path, "http://localhost:3000"), { method: "POST", body: fd, headers });
}

function badFormBody(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "20" },
    body: "not actually form data",
  });
}

describe("POST /api/tickets/:id/attachments", () => {
  it("asks for tickets:update", async () => {
    vi.mocked(addAttachment).mockResolvedValue(baseAttachment());
    const { POST } = await import("@/app/api/tickets/[id]/attachments/route");
    await POST(multipart("/api/tickets/t1/attachments", [{ name: "a.png", bytes: 10 }]), ticketCtx);
    expect(vi.mocked(requireAuth).mock.calls[0][1]).toBe("tickets:update");
  });

  it("returns 404 for a ticket the user can't see", async () => {
    db.ticket.findUnique.mockResolvedValue(null);
    const { POST } = await import("@/app/api/tickets/[id]/attachments/route");
    const res = await POST(multipart("/api/tickets/t1/attachments", [{ name: "a.png", bytes: 10 }]), ticketCtx);
    expect(res.status).toBe(404);
  });

  it("returns 411 when Content-Length is missing", async () => {
    const { POST } = await import("@/app/api/tickets/[id]/attachments/route");
    const res = await POST(multipart("/api/tickets/t1/attachments", [{ name: "a.png", bytes: 10 }], null), ticketCtx);
    expect(res.status).toBe(411);
  });

  it("returns 413 when Content-Length declares more than the cap", async () => {
    const { POST } = await import("@/app/api/tickets/[id]/attachments/route");
    const res = await POST(multipart("/api/tickets/t1/attachments", [{ name: "a.png", bytes: 10 }], MAX_UPLOAD_BYTES + 1), ticketCtx);
    expect(res.status).toBe(413);
  });

  it("returns 400 for a body that isn't valid form data", async () => {
    const { POST } = await import("@/app/api/tickets/[id]/attachments/route");
    const res = await POST(badFormBody("/api/tickets/t1/attachments"), ticketCtx);
    expect(res.status).toBe(400);
    expect((await parseJsonResponse(res)).error).toBe("Couldn't read the upload");
  });

  it("returns 400 with no files", async () => {
    const { POST } = await import("@/app/api/tickets/[id]/attachments/route");
    const res = await POST(multipart("/api/tickets/t1/attachments", []), ticketCtx);
    expect(res.status).toBe(400);
  });

  it("returns 400 with more than 5 files", async () => {
    const files = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}.png`, bytes: 10 }));
    const { POST } = await import("@/app/api/tickets/[id]/attachments/route");
    const res = await POST(multipart("/api/tickets/t1/attachments", files), ticketCtx);
    expect(res.status).toBe(400);
  });

  it("returns 413 for a file over 10 MB", async () => {
    const { POST } = await import("@/app/api/tickets/[id]/attachments/route");
    const res = await POST(multipart("/api/tickets/t1/attachments", [{ name: "big.png", bytes: MAX_BYTES + 1 }]), ticketCtx);
    expect(res.status).toBe(413);
  });

  it("returns 415 for a non-image", async () => {
    vi.mocked(isAllowedImage).mockResolvedValue(false);
    const { POST } = await import("@/app/api/tickets/[id]/attachments/route");
    const res = await POST(multipart("/api/tickets/t1/attachments", [{ name: "a.txt", bytes: 10 }]), ticketCtx);
    expect(res.status).toBe(415);
  });

  it("returns 201 and calls addAttachment once per file", async () => {
    vi.mocked(addAttachment).mockResolvedValue(baseAttachment());
    const { POST } = await import("@/app/api/tickets/[id]/attachments/route");
    const res = await POST(
      multipart("/api/tickets/t1/attachments", [
        { name: "a.png", bytes: 10 },
        { name: "b.png", bytes: 10 },
      ]),
      ticketCtx
    );
    expect(res.status).toBe(201);
    expect(addAttachment).toHaveBeenCalledTimes(2);
    const body = await parseJsonResponse(res);
    expect(body.data).toHaveLength(2);
  });

  it("returns 500 with what was already saved when a later file fails", async () => {
    vi.mocked(addAttachment)
      .mockResolvedValueOnce(baseAttachment())
      .mockRejectedValueOnce(new Error("disk full"));
    const { POST } = await import("@/app/api/tickets/[id]/attachments/route");
    const res = await POST(
      multipart("/api/tickets/t1/attachments", [
        { name: "a.png", bytes: 10 },
        { name: "b.png", bytes: 10 },
      ]),
      ticketCtx
    );
    expect(res.status).toBe(500);
    const body = await parseJsonResponse(res);
    expect(body.saved).toBe(1);
  });
});

describe("GET /api/attachments/:id", () => {
  it("returns 202 for pending", async () => {
    db.attachment.findUnique.mockResolvedValue({ ...baseAttachment(), status: "pending", maskedKey: null });
    const { GET } = await import("@/app/api/attachments/[id]/route");
    const res = await GET(createRequest("/api/attachments/a1"), ctx);
    expect(res.status).toBe(202);
  });

  it("returns 409 for needs_check, even to staff, and never serves bytes", async () => {
    db.attachment.findUnique.mockResolvedValue({ ...baseAttachment(), status: "needs_check", maskedKey: null });
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    const { GET } = await import("@/app/api/attachments/[id]/route");
    const res = await GET(createRequest("/api/attachments/a1"), ctx);
    expect(res.status).toBe(409);
    const body = await parseJsonResponse(res);
    expect(body.status).toBe("needs_check");
    expect(store.get).not.toHaveBeenCalled();
  });

  it("returns the image to a viewer for clean, with the right headers", async () => {
    db.attachment.findUnique.mockResolvedValue({ ...baseAttachment(), status: "clean" });
    asRole("viewer");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "p1" }]);
    const { GET } = await import("@/app/api/attachments/[id]/route");
    const res = await GET(createRequest("/api/attachments/a1"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("GET /api/attachments/:id/original", () => {
  it("asks for attachments:original", async () => {
    const { GET } = await import("@/app/api/attachments/[id]/original/route");
    await GET(createRequest("/api/attachments/a1/original"), ctx);
    expect(vi.mocked(requireAuth).mock.calls[0][1]).toBe("attachments:original");
  });

  it("writes the audit row before sending any bytes", async () => {
    const { GET } = await import("@/app/api/attachments/[id]/original/route");
    const res = await GET(createRequest("/api/attachments/a1/original"), ctx);
    expect(res.status).toBe(200);
    expect(db.activityLog.create).toHaveBeenCalledWith({
      data: {
        action: "attachment.original_viewed",
        entity: "attachment",
        entityId: "a1",
        description: expect.any(String),
        userName: "U",
      },
    });
    const auditOrder = db.activityLog.create.mock.invocationCallOrder[0];
    const readOrder = store.get.mock.invocationCallOrder[0];
    expect(auditOrder).toBeLessThan(readOrder);
  });

  it("fails closed: a 500 and no bytes when the audit write fails", async () => {
    db.activityLog.create.mockRejectedValue(new Error("db down"));
    const { GET } = await import("@/app/api/attachments/[id]/original/route");
    const res = await GET(createRequest("/api/attachments/a1/original"), ctx);
    expect(res.status).toBe(500);
    expect(store.get).not.toHaveBeenCalled();
  });

  it("returns 410 when originalKey is null", async () => {
    db.attachment.findUnique.mockResolvedValue({ ...baseAttachment(), originalKey: null });
    const { GET } = await import("@/app/api/attachments/[id]/original/route");
    const res = await GET(createRequest("/api/attachments/a1/original"), ctx);
    expect(res.status).toBe(410);
  });
});

describe("POST /api/attachments/:id/check", () => {
  it("confirm calls confirmAttachment", async () => {
    vi.mocked(confirmAttachment).mockResolvedValue(baseAttachment());
    const { POST } = await import("@/app/api/attachments/[id]/check/route");
    const res = await POST(createRequest("/api/attachments/a1/check", { method: "POST", body: { action: "confirm" } }), ctx);
    expect(res.status).toBe(200);
    expect(confirmAttachment).toHaveBeenCalled();
  });

  it("mask with valid boxes calls remask", async () => {
    vi.mocked(remask).mockResolvedValue(baseAttachment());
    const { POST } = await import("@/app/api/attachments/[id]/check/route");
    const res = await POST(
      createRequest("/api/attachments/a1/check", { method: "POST", body: { action: "mask", boxes: [{ x: 0, y: 0, w: 10, h: 10 }] } }),
      ctx
    );
    expect(res.status).toBe(200);
    expect(remask).toHaveBeenCalled();
  });

  it("mask with an empty box list returns 400", async () => {
    const { POST } = await import("@/app/api/attachments/[id]/check/route");
    const res = await POST(createRequest("/api/attachments/a1/check", { method: "POST", body: { action: "mask", boxes: [] } }), ctx);
    expect(res.status).toBe(400);
  });

  it("mask with an oversized box list returns 400", async () => {
    const boxes = Array.from({ length: 51 }, () => ({ x: 0, y: 0, w: 10, h: 10 }));
    const { POST } = await import("@/app/api/attachments/[id]/check/route");
    const res = await POST(createRequest("/api/attachments/a1/check", { method: "POST", body: { action: "mask", boxes } }), ctx);
    expect(res.status).toBe(400);
  });

  it("returns 409 while pending", async () => {
    db.attachment.findUnique.mockResolvedValue({ ...baseAttachment(), status: "pending" });
    const { POST } = await import("@/app/api/attachments/[id]/check/route");
    const res = await POST(createRequest("/api/attachments/a1/check", { method: "POST", body: { action: "confirm" } }), ctx);
    expect(res.status).toBe(409);
  });

  it("returns 410 when the original is gone", async () => {
    vi.mocked(remask).mockRejectedValue(new Error("the original was deleted"));
    const { POST } = await import("@/app/api/attachments/[id]/check/route");
    const res = await POST(
      createRequest("/api/attachments/a1/check", { method: "POST", body: { action: "mask", boxes: [{ x: 0, y: 0, w: 10, h: 10 }] } }),
      ctx
    );
    expect(res.status).toBe(410);
  });
});

describe("POST /api/attachments/:id/check when two people check at once", () => {
  it("returns 409 for confirm", async () => {
    vi.mocked(confirmAttachment).mockRejectedValue(new Error("changed by someone else"));
    const { POST } = await import("@/app/api/attachments/[id]/check/route");
    const res = await POST(createRequest("/api/attachments/a1/check", { method: "POST", body: { action: "confirm" } }), ctx);
    expect(res.status).toBe(409);
    expect((await parseJsonResponse(res)).error).toBe("Someone else just changed this image. Reload and try again.");
  });

  it("returns 409 for mask", async () => {
    vi.mocked(remask).mockRejectedValue(new Error("changed by someone else"));
    const { POST } = await import("@/app/api/attachments/[id]/check/route");
    const res = await POST(
      createRequest("/api/attachments/a1/check", { method: "POST", body: { action: "mask", boxes: [{ x: 0, y: 0, w: 10, h: 10 }] } }),
      ctx
    );
    expect(res.status).toBe(409);
  });
});

describe("an attachment on a ticket outside the user's projects", () => {
  beforeEach(() => {
    asRole("staff");
    db.projectAccess.findMany.mockResolvedValue([{ projectId: "other" }]);
  });

  it("GET masked gets 404", async () => {
    const { GET } = await import("@/app/api/attachments/[id]/route");
    const res = await GET(createRequest("/api/attachments/a1"), ctx);
    expect(res.status).toBe(404);
  });

  it("GET original gets 404", async () => {
    const { GET } = await import("@/app/api/attachments/[id]/original/route");
    const res = await GET(createRequest("/api/attachments/a1/original"), ctx);
    expect(res.status).toBe(404);
  });

  it("POST check gets 404", async () => {
    const { POST } = await import("@/app/api/attachments/[id]/check/route");
    const res = await POST(createRequest("/api/attachments/a1/check", { method: "POST", body: { action: "confirm" } }), ctx);
    expect(res.status).toBe(404);
  });
});
