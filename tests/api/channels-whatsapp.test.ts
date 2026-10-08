import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { hasPermission, type Permission } from "@/lib/rbac";
import { createRequest, parseJsonResponse } from "../helpers/request";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const asRole = (role: string) =>
  vi.mocked(requireAuth).mockImplementation(async (_req, permission) =>
    permission && !hasPermission(role, permission as Permission)
      ? NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 })
      : ({ userId: "u1", role, username: "u", name: "U", authMethod: "cookie", companyId: "test-company" } as never)
  );

const row = (status: string, config: Record<string, unknown> = {}) => ({
  id: "ch1",
  type: "whatsapp",
  status,
  config,
  updatedAt: new Date("2026-10-07T10:00:00Z"),
});

let current: ReturnType<typeof row> | null;

beforeEach(() => {
  for (const fn of Object.values(db.channel)) fn.mockReset();
  current = null;
  db.channel.findUnique.mockImplementation(async () => current);
  db.channel.updateMany.mockImplementation(async ({ data }: { data: { status: string; config: Record<string, unknown> } }) => {
    current = { ...current!, status: data.status, config: data.config };
    return { count: 1 };
  });
  db.channel.create.mockImplementation(async ({ data }: { data: { status: string; config: Record<string, unknown> } }) => {
    current = row(data.status, data.config);
    return current;
  });
  asRole("admin");
});

const post = (action: string) => createRequest("/api/channels/whatsapp", { method: "POST", body: { action } });

describe("GET /api/channels/whatsapp", () => {
  it("shows the qr to admins only", async () => {
    current = row("qr", { qr: "data:image/png;base64,QR" });
    const { GET } = await import("@/app/api/channels/whatsapp/route");
    expect((await parseJsonResponse(await GET(createRequest("/api/channels/whatsapp"), {} as never))).qr).toBe(
      "data:image/png;base64,QR"
    );
    asRole("supervisor");
    const body = await parseJsonResponse(await GET(createRequest("/api/channels/whatsapp"), {} as never));
    expect(body.status).toBe("qr");
    expect(body.qr).toBeNull();
  });

  it("is stale when the worker hasn't been seen for 4 minutes", async () => {
    current = row("connected", { seenAt: new Date(Date.now() - 4 * 60_000).toISOString(), phone: "60111" });
    const { GET } = await import("@/app/api/channels/whatsapp/route");
    const body = await parseJsonResponse(await GET(createRequest("/api/channels/whatsapp"), {} as never));
    expect(body).toMatchObject({ status: "connected", stale: true, phone: "60111" });
    current = row("connected", { seenAt: new Date().toISOString() });
    expect((await parseJsonResponse(await GET(createRequest("/api/channels/whatsapp"), {} as never))).stale).toBe(false);
  });
});

describe("POST /api/channels/whatsapp", () => {
  it("connect from off asks the worker to start", async () => {
    current = row("off");
    const { POST } = await import("@/app/api/channels/whatsapp/route");
    const res = await POST(post("connect"), {} as never);
    expect(res.status).toBe(200);
    expect((await parseJsonResponse(res)).status).toBe("starting");
  });

  it("connect while connected is a 409", async () => {
    current = row("connected");
    const { POST } = await import("@/app/api/channels/whatsapp/route");
    const res = await POST(post("connect"), {} as never);
    expect(res.status).toBe(409);
    expect((await parseJsonResponse(res)).error).toBe("Already running");
  });

  it("unlink asks the worker to stop and log out", async () => {
    current = row("connected", { phone: "60111" });
    const { POST } = await import("@/app/api/channels/whatsapp/route");
    const res = await POST(post("unlink"), {} as never);
    expect(res.status).toBe(200);
    expect(current!.status).toBe("stopping");
    expect(current!.config).toMatchObject({ unlink: true, phone: "60111" });
  });

  it("stop with nothing running is a 409", async () => {
    current = row("off");
    const { POST } = await import("@/app/api/channels/whatsapp/route");
    expect((await POST(post("stop"), {} as never)).status).toBe(409);
  });

  it("an unknown action is a 400", async () => {
    const { POST } = await import("@/app/api/channels/whatsapp/route");
    expect((await POST(post("disconnect"), {} as never)).status).toBe(400);
  });

  it("a null or non-object body is a 400", async () => {
    current = row("off");
    const { POST } = await import("@/app/api/channels/whatsapp/route");
    for (const body of ["null", '"connect"', "not json"]) {
      const req = new NextRequest("http://localhost:3000/api/channels/whatsapp", { method: "POST", body });
      expect((await POST(req, {} as never)).status).toBe(400);
    }
    expect(current!.status).toBe("off");
  });

  it("supervisors can't change it", async () => {
    asRole("supervisor");
    current = row("off");
    const { POST } = await import("@/app/api/channels/whatsapp/route");
    expect((await POST(post("connect"), {} as never)).status).toBe(403);
    expect(current!.status).toBe("off");
  });
});

describe("PUT /api/channels/whatsapp", () => {
  it("points the old save button at the new actions", async () => {
    const { PUT } = await import("@/app/api/channels/whatsapp/route");
    const res = await PUT(createRequest("/api/channels/whatsapp", { method: "PUT", body: {} }), {} as never);
    expect(res.status).toBe(405);
    expect((await parseJsonResponse(res)).error).toBe("Use connect, stop or unlink");
  });
});

describe("generic /api/channels", () => {
  it("won't save the whatsapp row", async () => {
    current = row("connected", { phone: "60111" });
    const { POST } = await import("@/app/api/channels/route");
    const res = await POST(
      createRequest("/api/channels", { method: "POST", body: { type: "whatsapp", isActive: false, config: {} } }),
      {} as never
    );
    expect(res.status).toBe(400);
    expect((await parseJsonResponse(res)).error).toBe("Use the WhatsApp bot controls");
    expect(db.channel.upsert).not.toHaveBeenCalled();
  });

  it("never lists the bot's qr", async () => {
    db.channel.findMany.mockResolvedValue([row("qr", { qr: "data:image/png;base64,QR", phone: "" })]);
    asRole("supervisor");
    const { GET } = await import("@/app/api/channels/route");
    const list = await parseJsonResponse(await GET(createRequest("/api/channels"), {} as never));
    const wa = list.find((c: { type: string }) => c.type === "whatsapp");
    expect(wa.status).toBe("qr");
    expect(wa.config).toEqual({ phone: "" });
  });
});
