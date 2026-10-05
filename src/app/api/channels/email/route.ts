import { NextRequest, NextResponse } from "next/server";
import {
  startEmailListener,
  stopEmailListener,
  getEmailStatus,
} from "@/lib/channels/email";
import { withAuth } from "@/lib/tenant/with-auth";

export const GET = withAuth("channels:read", async (_request: NextRequest, _auth) => {
  const status = getEmailStatus();
  return NextResponse.json(status);
});

export const POST = withAuth("channels:update", async (request: NextRequest, _auth) => {
  const body = await request.json();
  const { action } = body;

  if (action === "connect") {
    await startEmailListener();
    const status = getEmailStatus();
    return NextResponse.json(status);
  }

  if (action === "disconnect") {
    await stopEmailListener();
    return NextResponse.json({ status: "disconnected" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
});
