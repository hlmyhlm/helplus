import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthenticated, type AuthContext } from "@/lib/route-auth";
import type { Permission } from "@/lib/rbac";
import { runWithCompany } from "./context";

// every logged-in api route goes through this, so queries are always scoped to the user's company
export function withAuth<C>(
  permission: Permission | undefined,
  handler: (request: NextRequest, auth: AuthContext, ctx: C) => Promise<Response>
) {
  return async (request: NextRequest, ctx: C): Promise<Response> => {
    const auth = await requireAuth(request, permission);
    if (!isAuthenticated(auth)) return auth;
    if (!permission && auth.role === "client") {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Insufficient permissions" } }, { status: 403 });
    }
    return runWithCompany(auth.companyId, () => handler(request, auth, ctx));
  };
}
