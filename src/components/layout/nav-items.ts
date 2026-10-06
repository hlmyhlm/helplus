import {
  BookOpen,
  Building2,
  LayoutDashboard,
  RadioTower,
  Settings,
  Ticket,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  match?: string[];
}

export interface SectionLink {
  name: string;
  href: string;
}

export interface SectionGroup {
  name: string;
  items: SectionLink[];
}

export const sectionGroups: SectionGroup[] = [
  {
    name: "Dashboard",
    items: [
      { name: "Overview", href: "/" },
      { name: "Analytics", href: "/analytics" },
    ],
  },
  {
    name: "Library",
    items: [
      { name: "Articles", href: "/knowledge" },
      { name: "Saved replies", href: "/canned-responses" },
      { name: "Test AI", href: "/knowledge/test" },
    ],
  },
  {
    name: "Clients",
    items: [
      { name: "Projects", href: "/projects" },
      { name: "People", href: "/customers" },
    ],
  },
  {
    name: "Settings",
    items: [
      { name: "General & AI", href: "/settings" },
      { name: "Team", href: "/team" },
      { name: "Business hours", href: "/business-hours" },
      { name: "SLA rules", href: "/sla" },
      { name: "Closing tickets", href: "/closing" },
      { name: "Automation", href: "/automation" },
      { name: "Integrations", href: "/webhooks" },
      { name: "Email log", href: "/email-log" },
      { name: "Users & roles", href: "/admin" },
      { name: "Audit log", href: "/activity" },
      { name: "Developer API", href: "/api-docs" },
    ],
  },
];

const hrefsOf = (group: string) =>
  sectionGroups.find((g) => g.name === group)!.items.map((i) => i.href);

export const mainNav: NavItem[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard, match: hrefsOf("Dashboard") },
  { name: "Tickets", href: "/tickets", icon: Ticket },
  { name: "Clients", href: "/projects", icon: Building2, match: hrefsOf("Clients") },
  { name: "Library", href: "/knowledge", icon: BookOpen, match: hrefsOf("Library") },
  { name: "Sources", href: "/channels", icon: RadioTower },
  { name: "Settings", href: "/settings", icon: Settings, match: hrefsOf("Settings") },
];

export const phoneTabs = mainNav.slice(0, 4);
export const moreNav = mainNav.slice(4);

function matches(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function isActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.match ?? [])].some((h) => matches(pathname, h));
}

export function groupFor(pathname: string): SectionGroup | null {
  return sectionGroups.find((g) => g.items.some((i) => matches(pathname, i.href))) ?? null;
}

export function activeHref(group: SectionGroup, pathname: string): string | null {
  const hits = group.items.filter((i) => matches(pathname, i.href));
  hits.sort((a, b) => b.href.length - a.href.length);
  return hits[0]?.href ?? null;
}

export function moreActive(pathname: string): boolean {
  return pathname === "/more" || moreNav.some((i) => isActive(pathname, i));
}
