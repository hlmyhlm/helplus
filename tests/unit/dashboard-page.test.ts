import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

beforeEach(() => {
  vi.mocked(redirect).mockClear();
});

describe("dashboard page", () => {
  it("sends a client back to login, they have no dashboard yet", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "c1",
      username: "client",
      name: "Client",
      role: "client",
      companyId: "co-a",
    });
    const { default: DashboardPage } = await import("@/app/(dashboard)/page");
    await expect(DashboardPage()).rejects.toThrow("redirect:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
