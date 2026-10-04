"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { isActive, moreActive, phoneTabs } from "./nav-items";

export function BottomTabs() {
  const pathname = usePathname();
  const tabs = [
    ...phoneTabs.map((i) => ({ name: i.name, href: i.href, icon: i.icon, active: isActive(pathname, i) })),
    { name: "More", href: "/more", icon: MoreHorizontal, active: moreActive(pathname) },
  ];

  return (
    <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 flex border-t border-helplus-border bg-helplus-surface pb-[env(safe-area-inset-bottom)]">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-1 h-14 text-[11px]",
            t.active ? "text-helplus-link font-semibold" : "text-helplus-text-light"
          )}
        >
          <t.icon className="h-5 w-5" strokeWidth={1.75} />
          {t.name}
        </Link>
      ))}
    </nav>
  );
}
