// roles, lowest to highest. each permission lists who may use it.

export const ROLES = ["client", "viewer", "staff", "supervisor", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

// roles that can log in to the dashboard
export const STAFF_ROLES = ["viewer", "staff", "supervisor", "admin", "owner"] as const;

export const PERMISSIONS = {
  // Conversations
  "conversations:read": ["viewer", "staff", "supervisor", "admin", "owner"],
  "conversations:create": ["staff", "supervisor", "admin", "owner"],
  "conversations:update": ["staff", "supervisor", "admin", "owner"],
  "conversations:delete": ["supervisor", "admin", "owner"],
  "conversations:assign": ["supervisor", "admin", "owner"],
  "conversations:transfer": ["staff", "supervisor", "admin", "owner"],

  // Messages
  "messages:read": ["viewer", "staff", "supervisor", "admin", "owner"],
  "messages:create": ["staff", "supervisor", "admin", "owner"],

  // Tickets
  "tickets:read": ["viewer", "staff", "supervisor", "admin", "owner"],
  "tickets:create": ["staff", "supervisor", "admin", "owner"],
  "tickets:update": ["staff", "supervisor", "admin", "owner"],
  "tickets:delete": ["supervisor", "admin", "owner"],

  // Customers
  "customers:read": ["viewer", "staff", "supervisor", "admin", "owner"],
  "customers:create": ["staff", "supervisor", "admin", "owner"],
  "customers:update": ["staff", "supervisor", "admin", "owner"],
  "customers:delete": ["admin", "owner"],
  "customers:export": ["supervisor", "admin", "owner"],

  // Knowledge Base
  "knowledge:read": ["viewer", "staff", "supervisor", "admin", "owner"],
  "knowledge:create": ["supervisor", "admin", "owner"],
  "knowledge:update": ["supervisor", "admin", "owner"],
  "knowledge:delete": ["admin", "owner"],

  // Team Management
  "team:read": ["viewer", "staff", "supervisor", "admin", "owner"],
  "team:create": ["admin", "owner"],
  "team:update": ["admin", "owner"],
  "team:delete": ["admin", "owner"],

  // Automation
  "automation:read": ["viewer", "staff", "supervisor", "admin", "owner"],
  "automation:create": ["supervisor", "admin", "owner"],
  "automation:update": ["supervisor", "admin", "owner"],
  "automation:delete": ["admin", "owner"],

  // Webhooks
  "webhooks:read": ["supervisor", "admin", "owner"],
  "webhooks:create": ["admin", "owner"],
  "webhooks:update": ["admin", "owner"],
  "webhooks:delete": ["admin", "owner"],

  // Settings
  "settings:read": ["admin", "owner"],
  "settings:update": ["admin", "owner"],

  // Admin (users, API keys)
  "admin:read": ["admin", "owner"],
  "admin:create": ["admin", "owner"],
  "admin:update": ["admin", "owner"],
  "admin:delete": ["admin", "owner"],

  // Analytics
  "analytics:read": ["viewer", "staff", "supervisor", "admin", "owner"],
  // project-aware stream comes later, see-all roles only for now
  "realtime:read": ["supervisor", "admin", "owner"],
  "analytics:export": ["supervisor", "admin", "owner"],

  // Activity Log
  "activity:read": ["supervisor", "admin", "owner"],

  // Channels
  "channels:read": ["supervisor", "admin", "owner"],
  "channels:update": ["admin", "owner"],

  // SLA
  "sla:read": ["viewer", "staff", "supervisor", "admin", "owner"],
  "sla:create": ["admin", "owner"],
  "sla:update": ["admin", "owner"],
  "sla:delete": ["admin", "owner"],

  // Business Hours
  "business-hours:read": ["viewer", "staff", "supervisor", "admin", "owner"],
  "business-hours:update": ["admin", "owner"],

  // Canned Responses
  "canned:read": ["staff", "supervisor", "admin", "owner"],
  "canned:create": ["supervisor", "admin", "owner"],
  "canned:update": ["supervisor", "admin", "owner"],
  "canned:delete": ["admin", "owner"],

  // Export
  "export:read": ["supervisor", "admin", "owner"],

  // Projects (clients)
  "projects:read": ["viewer", "staff", "supervisor", "admin", "owner"],
  "projects:manage": ["admin", "owner"],

  // Company (owner only)
  "company:manage": ["owner"],
} as const;

export type Permission = keyof typeof PERMISSIONS;

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role: string, permission: Permission): boolean {
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(role);
}

/**
 * Check if a role meets the minimum required role level.
 */
export function hasMinRole(role: string, minRole: Role): boolean {
  const roleIndex = ROLES.indexOf(role as Role);
  const minIndex = ROLES.indexOf(minRole);
  if (roleIndex === -1 || minIndex === -1) return false;
  return roleIndex >= minIndex;
}

/**
 * Get all permissions for a role.
 */
export function getPermissionsForRole(role: string): Permission[] {
  return (Object.entries(PERMISSIONS) as [Permission, readonly string[]][])
    .filter(([, roles]) => roles.includes(role))
    .map(([perm]) => perm);
}
