"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive, mainNav } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:flex w-56 flex-shrink-0 flex-col bg-helplus-sidebar text-white">
      <div className="flex items-center gap-2.5 h-16 px-5">
        {/* alt empty, the name is shown as text right next to it */}
        <Image src="/helplus.svg" alt="" width={24} height={24} />
        <span className="text-[17px] font-semibold tracking-tight text-white">
          Help+
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {mainNav.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 h-10 px-3 rounded-md text-sm transition-colors",
                active
                  ? "bg-helplus-sidebar-active text-white font-medium shadow-[inset_2px_0_0_var(--helplus-primary-light)]"
                  : "text-white/70 hover:bg-helplus-sidebar-hover hover:text-white"
              )}
            >
              <item.icon className="h-[17px] w-[17px]" strokeWidth={1.75} />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
