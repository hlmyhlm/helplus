"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Header } from "@/components/layout/header";
import { cn } from "@/lib/utils";
import { unwrapList, listMeta } from "@/lib/api-client";
import { TicketList, type TicketRow } from "@/components/tickets/ticket-list";
import { QuickAddDialog } from "@/components/tickets/quick-add-dialog";
import { STATUS_LABELS, type TicketStatus } from "@/lib/tickets/status";

const CHIPS: { key: string; label: string; status: string; assignee?: string }[] = [
  { key: "open", label: "Open", status: "open" },
  { key: "mine", label: "Mine", status: "open", assignee: "me" },
  { key: "unassigned", label: "Unassigned", status: "open", assignee: "unassigned" },
  { key: "ai", label: STATUS_LABELS.ai_suggested, status: "ai_suggested" },
  { key: "reopened", label: STATUS_LABELS.reopened, status: "reopened" },
  { key: "closed", label: STATUS_LABELS.closed, status: "closed" },
  { key: "all", label: "All", status: "all" },
];

export default function TicketsPage() {
  const router = useRouter();
  const [chip, setChip] = useState("open");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [counts, setCounts] = useState<Partial<Record<TicketStatus, number>>>({});
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const c = CHIPS.find((x) => x.key === chip)!;
    const params = new URLSearchParams({ status: c.status, page: String(page), limit: "25" });
    if (c.assignee) params.set("assignee", c.assignee);
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/tickets?${params}`);
    if (res.ok) {
      const json = await res.json();
      setRows(unwrapList<TicketRow>(json));
      setPages(listMeta(json)?.totalPages || 1);
      setCounts(json.counts ?? {});
    }
    setLoading(false);
  }, [chip, q, page]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const openCount = (["new", "ai_suggested", "answered", "reopened", "working"] as TicketStatus[]).reduce(
    (n, s) => n + (counts[s] ?? 0),
    0
  );
  const chipCount = (key: string) =>
    key === "open" ? openCount : key === "ai" ? counts.ai_suggested : key === "reopened" ? counts.reopened : key === "closed" ? counts.closed : undefined;

  return (
    <>
      <Header
        title="Tickets"
        description="Every issue from WhatsApp, the web form and imports"
        actions={
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" /> Quick add
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search ticket #, title, client…"
            className="flex-1 min-w-[180px] max-w-sm h-9 rounded-md border border-helplus-border bg-helplus-surface px-3 text-sm text-helplus-text"
          />
          {CHIPS.map((c) => (
            <button
              key={c.key}
              onClick={() => {
                setChip(c.key);
                setPage(1);
              }}
              className={cn(
                "h-8 px-3 rounded-md border text-xs inline-flex items-center gap-1.5",
                chip === c.key
                  ? "bg-helplus-primary border-helplus-primary text-white"
                  : "border-helplus-border bg-helplus-surface text-helplus-text"
              )}
            >
              {c.label}
              {chipCount(c.key) !== undefined && <span className="font-mono">{chipCount(c.key)}</span>}
            </button>
          ))}
        </div>
        {loading ? <div className="text-sm text-helplus-text-light">Loading…</div> : <TicketList rows={rows} />}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm text-helplus-text">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-8 px-3 rounded-md border border-helplus-border disabled:opacity-40">
              Previous
            </button>
            <span className="text-helplus-text-light">
              {page} / {pages}
            </span>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="h-8 px-3 rounded-md border border-helplus-border disabled:opacity-40">
              Next
            </button>
          </div>
        )}
      </div>
      <QuickAddDialog open={adding} onClose={() => setAdding(false)} onCreated={(id) => router.push(`/tickets/${id}`)} />
    </>
  );
}
