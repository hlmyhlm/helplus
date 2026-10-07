"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useCompany } from "@/lib/hooks/use-company";
import type { Permission } from "@/lib/rbac";
import { activeHref, groupFor, visibleItems } from "./nav-items";

export function SectionTabs() {
  const pathname = usePathname();
  const { canImport } = useCompany();
  const group = groupFor(pathname);
  if (!group) return null;
  // only hides links, the api still checks every request
  const can = (p: Permission) => (p === "imports:run" ? canImport : true);
  const items = visibleItems(group, can);
  // one tab on its own isn't a menu
  if (items.length < 2) return null;
  const current = activeHref({ ...group, items }, pathname);

  return (
    <div className="flex items-end gap-1 h-11 px-4 md:px-6 border-b border-helplus-border bg-helplus-surface overflow-x-auto">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={cn(
            "whitespace-nowrap inline-flex items-center h-10 px-3 text-sm border-b-2 -mb-px",
            i.href === current
              ? "border-helplus-link text-helplus-text font-medium"
              : "border-transparent text-helplus-text-light hover:text-helplus-text"
          )}
        >
          {i.name}
        </Link>
      ))}
    </div>
  );
}
