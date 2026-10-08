"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Header } from "@/components/layout/header";
import { cn } from "@/lib/utils";
import { unwrapList, listMeta } from "@/lib/api-client";
import { TicketList, type TicketRow } from "@/components/tickets/ticket-list";
import { QuickAddDialog } from "@/components/tickets/quick-add-dialog";
import { OPEN_STATUSES, STATUS_LABELS, type TicketStatus } from "@/lib/tickets/status";
import { useCompany } from "@/lib/hooks/use-company";

const CHIPS: { key: string; label: string; status: string; assignee?: string; sla?: "near" | "breached"; attention?: string }[] = [
  { key: "open", label: "Open", status: "open" },
  { key: "mine", label: "Mine", status: "open", assignee: "me" },
  { key: "unassigned", label: "Unassigned", status: "open", assignee: "unassigned" },
  { key: "breached", label: "Overdue", status: "open", sla: "breached" },
  { key: "near", label: "Due soon", status: "open", sla: "near" },
  { key: "screens", label: "Screens to check", status: "open", attention: "screens" },
  { key: "ai", label: STATUS_LABELS.ai_suggested, status: "ai_suggested" },
  { key: "reopened", label: STATUS_LABELS.reopened, status: "reopened" },
  { key: "closed", label: STATUS_LABELS.closed, status: "closed" },
  { key: "all", label: "All", status: "all" },
];

export default function TicketsPage() {
  return (
    <Suspense fallback={<TicketsPageFallback />}>
      <TicketsPageInner />
    </Suspense>
  );
}

function TicketsPageFallback() {
  return (
    <>
      <Header title="Tickets" description="Every issue from WhatsApp, the web form and imports" />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="text-sm text-helplus-text-light">Loading…</div>
      </div>
    </>
  );
}

function TicketsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") ?? "";
  const { projectLabel, canCheckScreens } = useCompany();
  const chipLabel = projectLabel === "Projects" ? "Project" : "Client";
  // links like ?status=all open on that chip
  const [chip, setChip] = useState(() => {
    const s = searchParams.get("status");
    return CHIPS.some((c) => c.key === s) ? s! : "open";
  });
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<TicketRow[]>([]);
  const [counts, setCounts] = useState<Partial<Record<TicketStatus, number>>>({});
  const [slaCounts, setSlaCounts] = useState<{ near: number; breached: number }>({ near: 0, breached: 0 });
  const [screensToCheck, setScreensToCheck] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [adding, setAdding] = useState(false);
  const [projectName, setProjectName] = useState("");
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const myRequest = ++requestId.current;
    setLoading(true);
    setLoadError("");
    const c = CHIPS.find((x) => x.key === chip)!;
    const params = new URLSearchParams({ status: c.status, page: String(page), limit: "25" });
    if (c.assignee) params.set("assignee", c.assignee);
    if (c.sla) params.set("sla", c.sla);
    if (c.attention) params.set("attention", c.attention);
    if (q.trim()) params.set("q", q.trim());
    if (projectId) params.set("projectId", projectId);
    try {
      const res = await fetch(`/api/tickets?${params}`);
      if (myRequest !== requestId.current) return; // a newer request started, drop this one
      if (res.ok) {
        const json = await res.json();
        if (myRequest !== requestId.current) return;
        setRows(unwrapList<TicketRow>(json));
        setPages(listMeta(json)?.totalPages || 1);
        setCounts(json.counts ?? {});
        setSlaCounts(json.slaCounts ?? { near: 0, breached: 0 });
        setScreensToCheck(json.screensToCheck ?? 0);
      } else {
        setLoadError("Couldn't load tickets.");
      }
    } catch {
      if (myRequest === requestId.current) setLoadError("Couldn't load tickets.");
    } finally {
      if (myRequest === requestId.current) setLoading(false);
    }
  }, [chip, q, page, projectId]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  // look up the name for the chip
  useEffect(() => {
    if (!projectId) {
      setProjectName("");
      return;
    }
    let cancelled = false;
    setProjectName("");
    fetch("/api/projects?archived=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const match = d ? unwrapList<{ id: string; name: string }>(d).find((p) => p.id === projectId) : null;
        setProjectName(match ? match.name : "unknown");
      })
      .catch(() => {
        if (!cancelled) setProjectName("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // a new project filter starts back at page 1
  useEffect(() => {
    setPage(1);
  }, [projectId]);

  const clearProject = () => {
    router.push("/tickets");
  };

  const openCount = OPEN_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const chipCount = (key: string) =>
    key === "open"
      ? openCount
      : key === "breached"
        ? slaCounts.breached
        : key === "near"
          ? slaCounts.near
          : key === "screens"
            ? screensToCheck
            : key === "ai"
              ? counts.ai_suggested
              : key === "reopened"
                ? counts.reopened
                : key === "closed"
                  ? counts.closed
                  : undefined;

  return (
    <>
      <Header
        title="Tickets"
        description="Every issue from WhatsApp, the web form and imports"
        actions={
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium whitespace-nowrap"
          >
            <Plus className="h-4 w-4" /> Quick add
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3">
        {projectId && (
          <button
            onClick={clearProject}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-helplus-border bg-helplus-surface text-xs text-helplus-text"
          >
            {chipLabel}: {projectName || "…"} <X className="h-3.5 w-3.5" />
          </button>
        )}
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
          {CHIPS.filter((c) => c.key !== "screens" || canCheckScreens).map((c) => (
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
        {loadError && <p className="text-sm text-helplus-danger">{loadError}</p>}
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
      <QuickAddDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(id, uploadError) => router.push(`/tickets/${id}${uploadError ? `?uploadError=${encodeURIComponent(uploadError)}` : ""}`)}
      />
    </>
  );
}
