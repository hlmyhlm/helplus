"use client";

import Link from "next/link";
import { formatRelativeTime } from "@/lib/utils";
import { StatusDot, sourceLabel } from "./status-dot";

export interface TicketRow {
  id: string;
  number: number;
  title: string;
  status: string;
  source: string;
  category: string;
  aiMatch: number | null;
  updatedAt: string;
  project: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  conversation: { customerName: string; customerContact: string } | null;
}

export function TicketList({ rows }: { rows: TicketRow[] }) {
  if (!rows.length) {
    return <div className="rounded-md border border-helplus-border bg-helplus-surface p-6 text-sm text-helplus-text-light">Nothing in this view.</div>;
  }
  return (
    <>
      <div className="hidden md:block rounded-md border border-helplus-border bg-helplus-surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-helplus-text-light border-b border-helplus-border">
              <th className="px-3 py-2 font-medium">ID</th>
              <th className="px-3 py-2 font-medium">Issue</th>
              <th className="px-3 py-2 font-medium">Client</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Handled by</th>
              <th className="px-3 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-helplus-border last:border-0 hover:bg-helplus-primary-50">
                <td className="px-3 py-3 font-mono text-xs text-helplus-text-light">
                  <Link href={`/tickets/${t.id}`}>#{t.number}</Link>
                </td>
                <td className="px-3 py-3">
                  <Link href={`/tickets/${t.id}`} className="font-medium text-helplus-text">
                    {t.title}
                  </Link>
                  <div className="text-xs text-helplus-text-light">
                    {t.project.name}
                    {t.category ? ` · ${t.category}` : ""}
                    {t.aiMatch ? ` · AI match ${t.aiMatch}%` : ""}
                  </div>
                </td>
                <td className="px-3 py-3 text-helplus-text">{t.conversation?.customerName ?? "Unknown"}</td>
                <td className="px-3 py-3 text-xs text-helplus-text-light">{sourceLabel(t.source)}</td>
                <td className="px-3 py-3">
                  <StatusDot status={t.status} />
                </td>
                <td className="px-3 py-3 text-xs text-helplus-text">{t.assignee?.name ?? <span className="text-helplus-text-light">Unassigned</span>}</td>
                <td className="px-3 py-3 text-xs text-helplus-text-light">{formatRelativeTime(t.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden space-y-2">
        {rows.map((t) => (
          <Link key={t.id} href={`/tickets/${t.id}`} className="block rounded-md border border-helplus-border bg-helplus-surface p-3">
            <div className="flex justify-between text-xs text-helplus-text-light">
              <span>
                <span className="font-mono">#{t.number}</span> · {sourceLabel(t.source)}
              </span>
              <span>{formatRelativeTime(t.updatedAt)}</span>
            </div>
            <div className="mt-1 mb-2 text-sm font-medium text-helplus-text">{t.title}</div>
            <div className="flex items-center gap-2">
              <StatusDot status={t.status} />
              <span className="text-xs text-helplus-text-light">
                {t.conversation?.customerName ?? "Unknown"} · {t.assignee?.name ?? "Unassigned"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
