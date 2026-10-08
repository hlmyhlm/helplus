"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { cn } from "@/lib/utils";
import { unwrapList, listMeta } from "@/lib/api-client";

interface EmailRow {
  id: string;
  to: string;
  subject: string;
  kind: string;
  status: string;
  attempts: number;
  lastError: string;
  createdAt: string;
  sentAt: string | null;
  ticketId: string | null;
}

const FILTERS = [
  { key: "failed", label: "Failed" },
  { key: "pending", label: "Pending" },
  { key: "sent", label: "Sent" },
  { key: "all", label: "All" },
];

const STATUS_TONE: Record<string, string> = {
  failed: "text-helplus-danger",
  pending: "text-helplus-warning",
  sending: "text-helplus-warning",
  sent: "text-helplus-success",
};

const DOT_TONE: Record<string, string> = {
  failed: "bg-helplus-danger",
  pending: "bg-helplus-warning",
  sending: "bg-helplus-warning",
  sent: "bg-helplus-success",
};

export default function EmailLogPage() {
  const [filter, setFilter] = useState("failed");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [rows, setRows] = useState<EmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retryError, setRetryError] = useState("");
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [stalePending, setStalePending] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/email-outbox?status=${filter}&page=${page}&limit=25`);
      if (res.ok) {
        const json = await res.json();
        setRows(unwrapList<EmailRow>(json));
        setPages(listMeta(json)?.totalPages || 1);
        setStalePending(json.stalePending ?? 0);
      } else {
        setLoadError("Couldn't load the email log.");
      }
    } catch {
      setLoadError("Couldn't load the email log.");
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    load();
  }, [load]);

  const retry = async (id: string) => {
    setRetryError("");
    setRetryingId(id);
    try {
      const res = await fetch(`/api/email-outbox/${id}/retry`, { method: "POST" });
      if (!res.ok) {
        setRetryError((await res.json().catch(() => ({}))).error ?? "Couldn't retry");
        return;
      }
      await load();
    } catch {
      setRetryError("Couldn't retry");
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <>
      <Header title="Email log" description="Alerts sent by the worker. Failed emails retry 5 times." />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setFilter(f.key);
                setPage(1);
              }}
              className={cn(
                "h-8 px-3 rounded-md border text-xs",
                filter === f.key
                  ? "bg-helplus-primary border-helplus-primary text-white"
                  : "border-helplus-border bg-helplus-surface text-helplus-text"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {stalePending > 0 && (
          <p className="text-sm text-helplus-warning">
            Worker not running? Some pending emails are over 10 minutes old.
          </p>
        )}

        {loadError && <p className="text-sm text-helplus-danger">{loadError}</p>}
        {retryError && <p className="text-sm text-helplus-danger">{retryError}</p>}

        {loading ? (
          <div className="text-sm text-helplus-text-light">Loading…</div>
        ) : !rows.length ? (
          <div className="rounded-md border border-helplus-border bg-helplus-surface p-6 text-center text-sm text-helplus-text-light">
            No emails here.
          </div>
        ) : (
          <div className="rounded-md border border-helplus-border bg-helplus-surface divide-y divide-helplus-border">
            {rows.map((r) => (
              <div key={r.id} className="p-4 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-helplus-text truncate">{r.subject}</p>
                    <p className="text-xs text-helplus-text-light truncate">
                      {r.to} · {r.kind}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={cn("inline-block h-2 w-2 rounded-full", DOT_TONE[r.status])} />
                    <span className={cn("text-xs font-medium", STATUS_TONE[r.status])}>{r.status}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-helplus-text-light">
                  <span>{r.attempts} attempt{r.attempts === 1 ? "" : "s"}</span>
                  <span>{new Date(r.createdAt).toLocaleString()}</span>
                  {(r.status === "failed" || r.status === "pending") && (
                    <button
                      onClick={() => retry(r.id)}
                      disabled={retryingId === r.id}
                      className="text-helplus-link disabled:opacity-60"
                    >
                      {retryingId === r.id ? "Retrying…" : "Retry"}
                    </button>
                  )}
                </div>
                {r.status === "failed" && r.lastError && (
                  <p className="text-xs text-helplus-danger">{r.lastError}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm text-helplus-text">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="h-8 px-3 rounded-md border border-helplus-border disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-helplus-text-light">{page} / {pages}</span>
            <button
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
              className="h-8 px-3 rounded-md border border-helplus-border disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </>
  );
}
