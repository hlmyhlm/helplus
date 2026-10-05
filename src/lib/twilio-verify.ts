import crypto from "crypto";

/**
 * Validate Twilio webhook request signature.
 * See: https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  if (!authToken || !signature) return false;

  // Sort params alphabetically and concatenate
  const data =
    url +
    Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key], "");

  const computed = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");

  const computedBuf = Buffer.from(computed);
  const signatureBuf = Buffer.from(signature);

  if (computedBuf.length !== signatureBuf.length) return false;

  return crypto.timingSafeEqual(computedBuf, signatureBuf);
}

export class UndecryptableSecretError extends Error {
  constructor(field: string) {
    super(`stored ${field} can't be decrypted`);
    this.name = "UndecryptableSecretError";
  }
}

/**
 * Twilio auth token from settings. "" means none is configured.
 * Throws when one is stored but can't be decrypted, so callers fail closed.
 */
export async function getTwilioAuthToken(): Promise<string> {
  // Dynamic import to avoid circular deps
  const { getSettingsWithStatus } = await import("@/lib/settings");
  const { settings, undecryptable } = await getSettingsWithStatus();
  if (undecryptable.includes("twilioToken")) throw new UndecryptableSecretError("twilioToken");
  return settings.twilioToken || "";
}

/**
 * Shared webhook check. With no token configured the request is let through
 * (signatures can't be checked); a stored token that can't be read rejects it.
 */
export async function isTwilioRequestAllowed(
  request: Request,
  params: Record<string, string>
): Promise<boolean> {
  let authToken: string;
  try {
    authToken = await getTwilioAuthToken();
  } catch (error) {
    if (error instanceof UndecryptableSecretError) return false;
    throw error;
  }
  if (!authToken) return true;
  const signature = request.headers.get("x-twilio-signature") || "";
  return validateTwilioSignature(authToken, signature, request.url, params);
}
