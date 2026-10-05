import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { maskSettingsSecrets } from "@/lib/security";
import { updateSettingsSchema, validateBody } from "@/lib/validations";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/tenant/with-auth";
import { SecretKeyError } from "@/lib/secrets";

export const GET = withAuth(
  "settings:read",
  async (_request: NextRequest, _auth) => {
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
);

export const PUT = withAuth(
  "settings:update",
  async (request: NextRequest, _auth) => {
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
      if (error instanceof SecretKeyError) {
        return NextResponse.json(
          { error: "Server encryption key is missing or invalid. Set HELPLUS_SECRET_KEY." },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Failed to update settings" },
        { status: 500 }
      );
    }
  }
);
