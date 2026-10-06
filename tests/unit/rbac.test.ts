import { describe, it, expect } from "vitest";
import { hasPermission, hasMinRole, getPermissionsForRole } from "@/lib/rbac";

describe("RBAC System", () => {
  describe("hasPermission", () => {
    it("admin should have all permissions", () => {
      expect(hasPermission("admin", "settings:read")).toBe(true);
      expect(hasPermission("admin", "settings:update")).toBe(true);
      expect(hasPermission("admin", "admin:delete")).toBe(true);
      expect(hasPermission("admin", "conversations:read")).toBe(true);
    });

    it("viewer should only have read permissions", () => {
      expect(hasPermission("viewer", "conversations:read")).toBe(true);
      expect(hasPermission("viewer", "conversations:create")).toBe(false);
      expect(hasPermission("viewer", "settings:read")).toBe(false);
    });

    it("staff should have create/update but not delete on most resources", () => {
      expect(hasPermission("staff", "conversations:create")).toBe(true);
      expect(hasPermission("staff", "conversations:update")).toBe(true);
      expect(hasPermission("staff", "conversations:delete")).toBe(false);
      expect(hasPermission("staff", "tickets:create")).toBe(true);
      expect(hasPermission("staff", "knowledge:create")).toBe(false);
    });

    it("supervisor should have most permissions except admin", () => {
      expect(hasPermission("supervisor", "conversations:delete")).toBe(true);
      expect(hasPermission("supervisor", "knowledge:create")).toBe(true);
      expect(hasPermission("supervisor", "webhooks:read")).toBe(true);
      expect(hasPermission("supervisor", "admin:create")).toBe(false);
      expect(hasPermission("supervisor", "settings:update")).toBe(false);
    });

    it("should return false for invalid role", () => {
      expect(hasPermission("hacker", "conversations:read")).toBe(false);
    });

    it("should return false for invalid permission", () => {
      expect(hasPermission("admin", "nonexistent:read" as never)).toBe(false);
    });
  });

  describe("hasMinRole", () => {
    it("admin meets any minimum role", () => {
      expect(hasMinRole("admin", "viewer")).toBe(true);
      expect(hasMinRole("admin", "admin")).toBe(true);
    });

    it("viewer does not meet staff minimum", () => {
      expect(hasMinRole("viewer", "staff")).toBe(false);
    });

    it("staff meets staff minimum", () => {
      expect(hasMinRole("staff", "staff")).toBe(true);
    });

    it("invalid role returns false", () => {
      expect(hasMinRole("unknown", "admin")).toBe(false);
    });

    it("orders roles from client up to owner", () => {
      expect(hasMinRole("owner", "admin")).toBe(true);
      expect(hasMinRole("client", "viewer")).toBe(false);
    });
  });

  describe("getPermissionsForRole", () => {
    it("should return permissions array for a role", () => {
      const adminPerms = getPermissionsForRole("admin");
      expect(adminPerms.length).toBeGreaterThan(20);
      expect(adminPerms).toContain("settings:update");
    });

    it("viewer should have fewer permissions than admin", () => {
      const viewerPerms = getPermissionsForRole("viewer");
      const adminPerms = getPermissionsForRole("admin");
      expect(viewerPerms.length).toBeLessThan(adminPerms.length);
    });
  });

  it("owner can do everything admin can, plus company:manage", () => {
    for (const p of getPermissionsForRole("admin")) expect(hasPermission("owner", p)).toBe(true);
    expect(hasPermission("owner", "company:manage")).toBe(true);
    expect(hasPermission("admin", "company:manage")).toBe(false);
  });

  it("client has no dashboard permissions", () => {
    expect(getPermissionsForRole("client")).toEqual([]);
  });

  it("only admins and owners manage projects", () => {
    expect(hasPermission("staff", "projects:read")).toBe(true);
    expect(hasPermission("staff", "projects:manage")).toBe(false);
    expect(hasPermission("admin", "projects:manage")).toBe(true);
  });
});
