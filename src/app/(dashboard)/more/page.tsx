import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Header } from "@/components/layout/header";
import { moreNav, sectionGroups } from "@/components/layout/nav-items";

export default function MorePage() {
  const settings = sectionGroups.find((g) => g.name === "Settings")!;
  // settings has its own list below
  const pages = moreNav.filter((i) => i.name !== "Settings").map((i) => ({ name: i.name, href: i.href }));

  return (
    <>
      <Header title="More" />
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <LinkList title="Pages" items={pages} />
        <LinkList title="Settings" items={settings.items} />
      </div>
    </>
  );
}

function LinkList({ title, items }: { title: string; items: { name: string; href: string }[] }) {
  return (
    <section>
      <h3 className="px-1 mb-2 text-xs font-medium text-helplus-text-light">{title}</h3>
      <div className="rounded-md border border-helplus-border bg-helplus-surface divide-y divide-helplus-border">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className="flex items-center justify-between h-12 px-4 text-sm text-helplus-text"
          >
            {i.name}
            <ChevronRight className="h-4 w-4 text-helplus-text-light" />
          </Link>
        ))}
      </div>
    </section>
  );
}
