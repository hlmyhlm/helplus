import { NextRequest, NextResponse } from "next/server";
import {
  getWhatsAppStatus,
  initWhatsApp,
  disconnectWhatsApp,
} from "@/lib/channels/whatsapp";
import { withAuth } from "@/lib/tenant/with-auth";

export const GET = withAuth("channels:read", async (_request: NextRequest, _auth) => {
  const status = getWhatsAppStatus();
  return NextResponse.json(status);
});

export const POST = withAuth("channels:update", async (request: NextRequest, _auth) => {
  const body = await request.json();
  const { action } = body;

  if (action === "connect") {
    await initWhatsApp();
    // Wait a moment for QR to generate
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const status = getWhatsAppStatus();
    return NextResponse.json(status);
  }

  if (action === "disconnect") {
    await disconnectWhatsApp();
    return NextResponse.json({ status: "disconnected" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
});
