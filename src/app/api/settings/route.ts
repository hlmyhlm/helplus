import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { maskSettingsSecrets } from "@/lib/security";
import { updateSettingsSchema, validateBody } from "@/lib/validations";
import { logger } from "@/lib/logger";
import { requireAuth, isAuthenticated } from "@/lib/route-auth";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request, "settings:read");
  if (!isAuthenticated(auth)) return auth;

  try {
    return NextResponse.json(maskSettingsSecrets(await getSettings()));
  } catch (error) {
    logger.error("Failed to fetch settings:", error);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request, "settings:update");
  if (!isAuthenticated(auth)) return auth;

  try {
    const body = await request.json();

    // Remove fields that should not be updated directly
    delete body.id;
    delete body.createdAt;
    delete body.updatedAt;

    const validation = validateBody(updateSettingsSchema, body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    return NextResponse.json(maskSettingsSecrets(await saveSettings(validation.data)));
  } catch (error) {
    logger.error("Failed to update settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
