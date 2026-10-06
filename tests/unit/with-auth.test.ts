import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/route-auth";
import { currentCompanyId } from "@/lib/tenant/context";
import { withAuth } from "@/lib/tenant/with-auth";

const mockedRequireAuth = vi.mocked(requireAuth);

beforeEach(() => {
  mockedRequireAuth.mockReset();
});

const auth = (over: Record<string, unknown> = {}) => ({
  userId: "u1",
  role: "admin",
  username: "admin",
  name: "Admin",
  authMethod: "cookie" as const,
  companyId: "co-9",
  ...over,
});

describe("withAuth", () => {
  it("runs the handler inside the user's company", async () => {
    mockedRequireAuth.mockResolvedValue(auth());
    const handler = withAuth("tickets:read", async () => NextResponse.json({ company: currentCompanyId() }));
    const res = await handler({} as never, {} as never);
    expect(await res.json()).toEqual({ company: "co-9" });
    expect(mockedRequireAuth).toHaveBeenCalledWith({}, "tickets:read");
  });

  it("returns the auth error without calling the handler", async () => {
    const denied = NextResponse.json({ error: "no" }, { status: 401 });
    mockedRequireAuth.mockResolvedValue(denied);
    const inner = vi.fn();
    const res = await withAuth("tickets:read", inner)({} as never, {} as never);
    expect(res.status).toBe(401);
    expect(inner).not.toHaveBeenCalled();
  });

  it("keeps client users out of routes that don't name a permission", async () => {
    mockedRequireAuth.mockResolvedValue(auth({ role: "client" }));
    const inner = vi.fn();
    const res = await withAuth(undefined, inner)({} as never, {} as never);
    expect(res.status).toBe(403);
    expect(inner).not.toHaveBeenCalled();
  });

  it("passes the route context through", async () => {
    mockedRequireAuth.mockResolvedValue(auth());
    const ctx = { params: Promise.resolve({ id: "42" }) };
    const handler = withAuth("tickets:read", async (_req, _auth, c: typeof ctx) =>
      NextResponse.json(await c.params)
    );
    expect(await (await handler({} as never, ctx)).json()).toEqual({ id: "42" });
  });
});
