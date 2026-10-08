import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/tenant/with-auth";
import { hasPermission } from "@/lib/rbac";
import { readBot, requestStart, requestStop, STALE_MS, type BotState } from "@/lib/bot/state";

// the bot itself runs in the worker; this route only reads and requests changes on the channel row
function view(s: BotState, showQr: boolean) {
  return {
    status: s.status,
    stale: s.status === "connected" && (!s.seenAt || Date.now() - s.seenAt.getTime() > STALE_MS),
    phone: s.phone,
    error: s.error,
    seenAt: s.seenAt ? s.seenAt.toISOString() : null,
    qr: showQr ? s.qr : null,
  };
}

export const GET = withAuth("channels:read", async (_request: NextRequest, auth) => {
  return NextResponse.json(view(await readBot(), hasPermission(auth.role, "channels:update")));
});

export const POST = withAuth("channels:update", async (request: NextRequest) => {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  const action = (body as { action?: unknown }).action;

  if (action === "connect") {
    if (!(await requestStart())) return NextResponse.json({ error: "Already running" }, { status: 409 });
  } else if (action === "stop" || action === "unlink") {
    if (!(await requestStop(action === "unlink"))) return NextResponse.json({ error: "Not running" }, { status: 409 });
  } else {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  return NextResponse.json(view(await readBot(), true));
});

export const PUT = withAuth("channels:update", async () => {
  return NextResponse.json({ error: "Use connect, stop or unlink" }, { status: 405 });
});
