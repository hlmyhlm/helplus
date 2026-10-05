import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { hasPermission, Permission } from "@/lib/rbac";
import { systemPrisma } from "@/lib/prisma";

export interface AuthContext {
  userId: string;
  role: string;
  username: string;
  name: string;
  authMethod: "cookie" | "api_key";
  companyId: string;
}

/**
 * Authenticate via API key (X-API-Key header).
 */
async function authenticateApiKey(apiKey: string): Promise<AuthContext | null> {
  const key = await systemPrisma.apiKey.findUnique({
    where: { key: apiKey },
  });

  if (!key || !key.isActive) return null;

  // Update lastUsed timestamp
  systemPrisma.apiKey.update({
    where: { id: key.id },
    data: { lastUsed: new Date() },
  }).catch(() => { /* fire and forget */ });

  // API keys get admin-level access
  return {
    userId: "api-key:" + key.id,
    role: "admin",
    username: key.name,
    name: key.name,
    authMethod: "api_key",
    companyId: key.companyId,
  };
}

/**
 * Authenticate and authorize an API request.
 * Supports both cookie (JWT) and API key (X-API-Key header) auth.
 * Returns the auth context or a 401/403 response.
 */
export async function requireAuth(
  request: NextRequest,
  permission?: Permission
): Promise<AuthContext | NextResponse> {
  // Try API key auth first
  const apiKey = request.headers.get("x-api-key");
  if (apiKey) {
    const context = await authenticateApiKey(apiKey);
    if (!context) {
      return NextResponse.json(
        { error: { code: "INVALID_API_KEY", message: "Invalid or inactive API key" } },
        { status: 401 }
      );
    }

    if (permission && !hasPermission(context.role, permission)) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
        { status: 403 }
      );
    }

    return context;
  }

  // Fall back to cookie auth
  const token = request.cookies.get("helplus-token")?.value;

  if (!token) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Authentication required. Use cookie or X-API-Key header." } },
      { status: 401 }
    );
  }

  const payload = verifyToken(token);
  if (!payload) {
    return NextResponse.json(
      { error: { code: "INVALID_TOKEN", message: "Invalid or expired token" } },
      { status: 401 }
    );
  }

  const admin = await systemPrisma.admin.findUnique({
    where: { id: payload.userId },
    select: { id: true, username: true, name: true, role: true, companyId: true },
  });

  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "User not found" } },
      { status: 401 }
    );
  }

  // check against the db role, not the token's: the token can be stale if the role changed since login
  if (permission && !hasPermission(admin.role, permission)) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Insufficient permissions" } },
      { status: 403 }
    );
  }

  return {
    userId: admin.id,
    role: admin.role,
    username: admin.username,
    name: admin.name,
    authMethod: "cookie",
    companyId: admin.companyId,
  };
}

/**
 * Type guard: check if result is an auth context (not an error response).
 */
export function isAuthenticated(
  result: AuthContext | NextResponse
): result is AuthContext {
  return !(result instanceof NextResponse);
}
