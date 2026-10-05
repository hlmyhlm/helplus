import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/route-auth";
import { createRequest, parseJsonResponse } from "../helpers/request";

const mockPrisma = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const mockedRequireAuth = vi.mocked(requireAuth);

function authAs(role: string, over: Record<string, unknown> = {}) {
  mockedRequireAuth.mockResolvedValue({
    userId: "actor-1",
    role,
    username: "actor",
    name: "Actor",
    authMethod: "cookie",
    companyId: "test-company",
    ...over,
  });
}

function owner(over: Record<string, unknown> = {}) {
  return {
    id: "owner-1",
    username: "owner",
    name: "Owner",
    password: "hash",
    role: "owner",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...over,
  };
}

function staffUser(over: Record<string, unknown> = {}) {
  return {
    id: "staff-1",
    username: "staffer",
    name: "Staffer",
    password: "hash",
    role: "staff",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...over,
  };
}

beforeEach(() => {
  mockedRequireAuth.mockReset();
  for (const method of ["findUnique", "count", "update", "create", "delete"] as const) {
    mockPrisma.admin[method].mockReset();
  }
});

describe("PUT /api/admin/users/[id]", () => {
  it("admin changing an owner's password is forbidden", async () => {
    authAs("admin");
    mockPrisma.admin.findUnique.mockResolvedValue(owner());

    const { PUT } = await import("@/app/api/admin/users/[id]/route");
    const request = createRequest("/api/admin/users/owner-1", {
      method: "PUT",
      body: { password: "newpassword123" },
    });
    const response = await PUT(request, { params: Promise.resolve({ id: "owner-1" }) });

    expect(response.status).toBe(403);
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
  });

  it("admin changing an owner's name is forbidden", async () => {
    authAs("admin");
    mockPrisma.admin.findUnique.mockResolvedValue(owner());

    const { PUT } = await import("@/app/api/admin/users/[id]/route");
    const request = createRequest("/api/admin/users/owner-1", {
      method: "PUT",
      body: { name: "New Name" },
    });
    const response = await PUT(request, { params: Promise.resolve({ id: "owner-1" }) });

    expect(response.status).toBe(403);
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
  });

  it("owner changing another owner's name succeeds", async () => {
    authAs("owner");
    mockPrisma.admin.findUnique.mockResolvedValue(owner());
    mockPrisma.admin.update.mockResolvedValue(owner({ name: "New Name" }));

    const { PUT } = await import("@/app/api/admin/users/[id]/route");
    const request = createRequest("/api/admin/users/owner-1", {
      method: "PUT",
      body: { name: "New Name" },
    });
    const response = await PUT(request, { params: Promise.resolve({ id: "owner-1" }) });
    const data = await parseJsonResponse(response);

    expect(response.status).toBe(200);
    expect(data.name).toBe("New Name");
  });

  it("admin changing a staff user's role to supervisor succeeds", async () => {
    authAs("admin");
    mockPrisma.admin.findUnique.mockResolvedValue(staffUser());
    mockPrisma.admin.update.mockResolvedValue(staffUser({ role: "supervisor" }));

    const { PUT } = await import("@/app/api/admin/users/[id]/route");
    const request = createRequest("/api/admin/users/staff-1", {
      method: "PUT",
      body: { role: "supervisor" },
    });
    const response = await PUT(request, { params: Promise.resolve({ id: "staff-1" }) });
    const data = await parseJsonResponse(response);

    expect(response.status).toBe(200);
    expect(data.role).toBe("supervisor");
  });

  it("owner demoting the last owner is rejected", async () => {
    authAs("owner");
    mockPrisma.admin.findUnique.mockResolvedValue(owner());
    mockPrisma.admin.count.mockResolvedValue(1);

    const { PUT } = await import("@/app/api/admin/users/[id]/route");
    const request = createRequest("/api/admin/users/owner-1", {
      method: "PUT",
      body: { role: "admin" },
    });
    const response = await PUT(request, { params: Promise.resolve({ id: "owner-1" }) });

    expect(response.status).toBe(400);
    expect(mockPrisma.admin.update).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/admin/users/[id]", () => {
  it("admin deleting an owner is forbidden", async () => {
    authAs("admin");
    mockPrisma.admin.findUnique.mockResolvedValue(owner());

    const { DELETE } = await import("@/app/api/admin/users/[id]/route");
    const request = createRequest("/api/admin/users/owner-1", { method: "DELETE" });
    const response = await DELETE(request, { params: Promise.resolve({ id: "owner-1" }) });

    expect(response.status).toBe(403);
    expect(mockPrisma.admin.delete).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/users", () => {
  it("admin creating a user with role owner is forbidden", async () => {
    authAs("admin");
    mockPrisma.admin.findUnique.mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/users/route");
    const request = createRequest("/api/admin/users", {
      method: "POST",
      body: { username: "newowner", password: "secure123", role: "owner" },
    });
    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(mockPrisma.admin.create).not.toHaveBeenCalled();
  });

  it("owner creating a user with role owner succeeds", async () => {
    authAs("owner");
    mockPrisma.admin.findUnique.mockResolvedValue(null);
    mockPrisma.admin.create.mockResolvedValue(owner({ id: "owner-2", username: "newowner" }));

    const { POST } = await import("@/app/api/admin/users/route");
    const request = createRequest("/api/admin/users", {
      method: "POST",
      body: { username: "newowner", password: "secure123", role: "owner" },
    });
    const response = await POST(request);

    expect([200, 201]).toContain(response.status);
  });
  it("refuses a username another company already uses, with the usual message", async () => {
    authAs("admin");
    mockPrisma.admin.findUnique.mockResolvedValue(staffUser({ username: "taken", companyId: "other-company" }));

    const { POST } = await import("@/app/api/admin/users/route");
    const request = createRequest("/api/admin/users", {
      method: "POST",
      body: { username: "taken", password: "secure123" },
    });
    const response = await POST(request);

    expect(response.status).toBe(409);
    expect(await parseJsonResponse(response)).toEqual({ error: "Username already exists" });
    expect(mockPrisma.admin.findUnique).toHaveBeenCalledWith({ where: { username: "taken" } });
    expect(mockPrisma.admin.create).not.toHaveBeenCalled();
  });

  it("turns a unique clash on create into the same 409", async () => {
    authAs("admin");
    mockPrisma.admin.findUnique.mockResolvedValue(null);
    mockPrisma.admin.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));

    const { POST } = await import("@/app/api/admin/users/route");
    const request = createRequest("/api/admin/users", {
      method: "POST",
      body: { username: "racer", password: "secure123" },
    });
    const response = await POST(request);

    expect(response.status).toBe(409);
    expect(await parseJsonResponse(response)).toEqual({ error: "Username already exists" });
  });
});
