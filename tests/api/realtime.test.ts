import { describe, it, expect, vi } from "vitest";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/route-auth";
import { createRequest } from "../helpers/request";

describe("GET /api/realtime", () => {
  it("asks for realtime:read, so staff are refused", async () => {
    vi.mocked(requireAuth).mockResolvedValueOnce(NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }));
    const { GET } = await import("@/app/api/realtime/route");
    const res = await GET(createRequest("/api/realtime?channel=global"), {} as never);
    expect(res.status).toBe(403);
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "realtime:read");
  });
});
