"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Loader2, Play, RotateCcw } from "lucide-react";
import { Header } from "@/components/layout/header";
import { useCompany } from "@/lib/hooks/use-company";
import { KIND_LABELS, OrderPicker, StatusDot, errorText, statusLabel, type ImportJob } from "../shared";

interface Sender {
  name: string;
  count: number;
  isStaff: boolean;
}

interface WaPreview {
  order: "dmy" | "mdy";
  senders: Sender[];
  messages: number;
  issues: number;
  answered: number;
  attachments: number;
  images: number;
  skippedFiles: number;
  sample: { client: string; firstLine: string; answered: boolean }[];
}

type CsvRow = Record<string, string | number | null>;

interface CsvPreview {
  headers: string[];
  mapping: Record<string, string>;
  rows: CsvRow[];
  good: number;
  bad: number;
}

type Job = ImportJob & { preview: WaPreview | CsvPreview };

const FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "oldId", label: "Old ID", required: true },
  { key: "question", label: "Question", required: true },
  { key: "answer", label: "Answer" },
  { key: "title", label: "Title" },
  { key: "clientName", label: "Client name" },
  { key: "clientContact", label: "Client contact" },
  { key: "createdAt", label: "Created date" },
  { key: "closedAt", label: "Closed date" },
  { key: "category", label: "Category" },
  { key: "priority", label: "Priority" },
];

const button =
  "inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium disabled:opacity-50";
const plainButton =
  "inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-helplus-border bg-helplus-surface text-sm text-helplus-text";

export default function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { canImport, loaded } = useCompany();
  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/imports/${id}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(errorText(json, "Couldn't load this import."));
        return;
      }
      setLoadError("");
      setJob(json.data);
    } catch {
      setLoadError("Couldn't load this import.");
    }
  }, [id]);

  useEffect(() => {
    if (canImport) load();
  }, [canImport, load]);

  const working = job?.status === "queued" || job?.status === "running";
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [working, load]);

  return (
    <>
      <Header
        title={job?.fileName || "Import"}
        description={job ? `${KIND_LABELS[job.kind] ?? job.kind} · ${statusLabel(job.status)}` : undefined}
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        <Link href="/imports" className="inline-flex items-center gap-1 text-sm text-helplus-link">
          <ArrowLeft className="h-4 w-4" /> All imports
        </Link>
        {!canImport ? (
          loaded && <p className="text-sm text-helplus-text-light">Ask an admin or supervisor to run imports</p>
        ) : loadError ? (
          <p className="text-sm text-helplus-danger">{loadError}</p>
        ) : !job ? (
          <p className="text-sm text-helplus-text-light">Loading…</p>
        ) : job.status === "uploaded" ? (
          job.kind === "whatsapp" ? (
            <WhatsAppSetup job={job} preview={job.preview as WaPreview} onStarted={load} />
          ) : (
            <CsvSetup job={job} preview={job.preview as CsvPreview} onStarted={load} />
          )
        ) : working ? (
          <Progress job={job} />
        ) : job.status === "done" ? (
          <Done job={job} />
        ) : (
          <Failed job={job} onRetried={load} />
        )}
      </div>
    </>
  );
}

function useStart(id: string, onStarted: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/imports/${id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorText(json, "Couldn't start the import."));
        return;
      }
      onStarted();
    } catch {
      setError("Couldn't start the import. Check your connection.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, start };
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-helplus-border bg-helplus-surface p-4 space-y-3">
      {title && <h3 className="text-sm font-semibold text-helplus-text">{title}</h3>}
      {children}
    </section>
  );
}

function Counts({ items }: { items: [string, number][] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map(([label, n]) => (
        <div key={label} className="rounded-md border border-helplus-border bg-helplus-bg px-3 py-2">
          <div className="text-lg font-semibold font-mono text-helplus-text">{n}</div>
          <div className="text-xs text-helplus-text-light">{label}</div>
        </div>
      ))}
    </div>
  );
}

function WhatsAppSetup({ job, preview, onStarted }: { job: Job; preview: WaPreview; onStarted: () => void }) {
  const [order, setOrder] = useState<"dmy" | "mdy">(job.options.order ?? preview.order ?? "dmy");
  const [staff, setStaff] = useState<Set<string>>(() => new Set(preview.senders.filter((s) => s.isStaff).map((s) => s.name)));
  const { busy, error, start } = useStart(job.id, onStarted);

  const toggle = (name: string) =>
    setStaff((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="space-y-4">
      <Counts
        items={[
          ["Messages", preview.messages],
          ["Issues", preview.issues],
          ["Answered", preview.answered],
          ["Attachments", preview.attachments],
        ]}
      />
      <Card>
        <OrderPicker value={order} onChange={setOrder} disabled={busy} />
      </Card>
      <Card title="Who's who">
        <p className="text-sm text-helplus-text-light">Messages from staff become replies. Everyone else is a client.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-helplus-text-light">
                <th className="py-1.5 pr-3 font-medium">Sender</th>
                <th className="py-1.5 pr-3 font-medium">Messages</th>
                <th className="py-1.5 font-medium">Staff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-helplus-border">
              {preview.senders.map((s, i) => (
                <tr key={i}>
                  <td className="py-2 pr-3 text-helplus-text break-all">{s.name}</td>
                  <td className="py-2 pr-3 font-mono text-helplus-text-light">{s.count}</td>
                  <td className="py-2">
                    <input
                      type="checkbox"
                      aria-label={`${s.name} is staff`}
                      checked={staff.has(s.name)}
                      disabled={busy}
                      onChange={() => toggle(s.name)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Sample issues">
        <p className="text-xs text-helplus-text-light">The sample uses the ticks as first guessed.</p>
        {preview.sample.length === 0 ? (
          <p className="text-sm text-helplus-text-light">No issues found.</p>
        ) : (
          <ul className="divide-y divide-helplus-border">
            {preview.sample.map((s, i) => (
              <li key={i} className="py-2 text-sm">
                <div className="text-helplus-text">{s.firstLine || "(attachment)"}</div>
                <div className="text-xs text-helplus-text-light">
                  {s.client} · {s.answered ? "answered" : "no reply"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {error && <p className="text-sm text-helplus-danger">{error}</p>}
      <button className={button} disabled={busy} onClick={() => start({ order, staff: [...staff] })}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        Start import
      </button>
    </div>
  );
}

function CsvSetup({ job, preview, onStarted }: { job: Job; preview: CsvPreview; onStarted: () => void }) {
  const [order, setOrder] = useState<"dmy" | "mdy">(job.options.order ?? "dmy");
  const [mapping, setMapping] = useState<Record<string, string>>(() => ({ ...(job.options.mapping ?? preview.mapping) }));
  const { busy, error, start } = useStart(job.id, onStarted);
  const ready = Boolean(mapping.oldId && mapping.question);
  const mapped = FIELDS.filter((f) => preview.mapping[f.key]);
  const changed = FIELDS.some((f) => (mapping[f.key] ?? "") !== (preview.mapping[f.key] ?? ""));

  const pick = (field: string, header: string) =>
    setMapping((prev) => {
      const next = { ...prev };
      if (header) next[field] = header;
      else delete next[field];
      return next;
    });

  return (
    <div className="space-y-4">
      <Counts
        items={[
          ["Good rows", preview.good],
          ["Bad rows", preview.bad],
        ]}
      />
      <Card title="Columns">
        <div className="divide-y divide-helplus-border">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 py-2">
              <span className="sm:w-40 text-sm text-helplus-text">
                {f.label}
                {f.required && <span className="text-helplus-danger"> *</span>}
              </span>
              <select
                value={mapping[f.key] ?? ""}
                disabled={busy}
                onChange={(e) => pick(f.key, e.target.value)}
                className="w-full sm:max-w-xs h-9 rounded-md border border-helplus-border bg-helplus-surface px-2 text-sm text-helplus-text"
              >
                <option value="">(not used)</option>
                {preview.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="text-xs text-helplus-text-light">
          <span className="text-helplus-danger">*</span> required
        </p>
      </Card>
      <Card>
        <OrderPicker value={order} onChange={setOrder} disabled={busy} />
      </Card>
      <Card title="First rows">
        {changed && <p className="text-xs text-helplus-text-light">The preview and counts use the columns as first guessed.</p>}
        {preview.rows.length === 0 ? (
          <p className="text-sm text-helplus-text-light">No good rows with these columns.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-helplus-text-light">
                  <th className="py-1.5 pr-3 font-medium">Line</th>
                  {mapped.map((f) => (
                    <th key={f.key} className="py-1.5 pr-3 font-medium whitespace-nowrap">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-helplus-border">
                {preview.rows.map((r) => (
                  <tr key={String(r.line)}>
                    <td className="py-2 pr-3 font-mono text-helplus-text-light">{r.line}</td>
                    {mapped.map((f) => (
                      <td key={f.key} className="py-2 pr-3 text-helplus-text max-w-[16rem] truncate">
                        {cell(r[f.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {error && <p className="text-sm text-helplus-danger">{error}</p>}
      {!ready && <p className="text-sm text-helplus-text-light">Pick the columns for Old ID and Question to start.</p>}
      <button className={button} disabled={busy || !ready} onClick={() => start({ order, mapping })}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        Start import
      </button>
    </div>
  );
}

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString();
  return String(v);
}

function Progress({ job }: { job: Job }) {
  const noun = job.kind === "csv" ? "rows" : "issues";
  const fallback = job.kind === "csv" ? (job.preview as CsvPreview).good : (job.preview as WaPreview).issues;
  const total = job.stats.total ?? fallback ?? 0;
  const done = Math.min(job.progress.next ?? 0, total);
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm text-helplus-text">
        <Loader2 className="h-4 w-4 animate-spin text-helplus-link" />
        {job.status === "queued" ? `Waiting for the worker. ${total} ${noun} to import…` : `Imported ${done} of ${total} ${noun}…`}
      </div>
      <p className="text-xs text-helplus-text-light">This page checks again every 5 seconds.</p>
    </Card>
  );
}

function Done({ job }: { job: Job }) {
  const s = job.stats;
  const [drafts, setDrafts] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/knowledge/drafts?count=1&projectId=${encodeURIComponent(job.projectId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.count === "number") setDrafts(d.count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [job.projectId]);

  const items: [string, number][] =
    job.kind === "csv"
      ? [
          ["Created", s.created ?? 0],
          ["Already in", s.skipped ?? 0],
          ["Bad rows", s.bad ?? 0],
          ["Failed", s.failed ?? 0],
        ]
      : [
          ["Created", s.created ?? 0],
          ["Already in", s.skipped ?? 0],
          ["Images", s.images ?? 0],
          ["Failed", s.failed ?? 0],
        ];
  const errors = job.progress.errors ?? [];
  const project = encodeURIComponent(job.projectId);

  return (
    <div className="space-y-4">
      <Counts items={items} />
      {job.kind === "whatsapp" && (s.merged || s.announcements || s.missingMedia || s.skippedFiles) ? (
        <p className="text-sm text-helplus-text-light">
          {[
            s.merged ? `${s.merged} merged` : "",
            s.announcements ? `${s.announcements} staff announcements skipped` : "",
            s.missingMedia ? `${s.missingMedia} missing media` : "",
            s.skippedFiles ? `${s.skippedFiles} files skipped (videos, voice notes, documents)` : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      {(s.images ?? 0) > 0 && (
        <p className="text-sm text-helplus-text">
          {s.images} screenshots are being checked for IC numbers in the background.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Link href={`/tickets?projectId=${project}&status=all`} className={button}>
          See tickets
        </Link>
        <Link href={`/knowledge/drafts?projectId=${project}`} className={plainButton}>
          Review Library drafts{drafts !== null ? ` (${drafts})` : ""}
        </Link>
        {job.kind === "csv" && (s.bad ?? 0) > 0 && (
          <a href={`/api/imports/${job.id}/bad-rows`} download className={plainButton}>
            <Download className="h-4 w-4" /> Download bad rows
          </a>
        )}
      </div>
      {errors.length > 0 && (
        <Card title="Problems">
          <ul className="space-y-1 text-sm text-helplus-danger">
            {errors.map((e, i) => (
              <li key={i} className="break-words">
                {e}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Failed({ job, onRetried }: { job: Job; onRetried: () => void }) {
  const { busy, error, start } = useStart(job.id, onRetried);
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm font-medium text-helplus-text">
        <StatusDot status="failed" /> The import stopped
      </div>
      <p className="text-sm text-helplus-danger break-words">{job.error || "Something went wrong."}</p>
      {error && <p className="text-sm text-helplus-danger">{error}</p>}
      <button className={button} disabled={busy} onClick={() => start({})}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
        Try again
      </button>
    </Card>
  );
}
