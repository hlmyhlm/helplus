"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, MessageCircle, Upload, Loader2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { useCompany } from "@/lib/hooks/use-company";
import { unwrapList } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { KIND_LABELS, StatusDot, errorText, formatWhen, type ImportJob } from "./shared";

interface Project {
  id: string;
  name: string;
  archived: boolean;
  isDefault: boolean;
}

export default function ImportsPage() {
  const { canImport, loaded } = useCompany();
  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!canImport) return;
    let cancelled = false;
    Promise.all([fetch("/api/projects?archived=1"), fetch("/api/imports")])
      .then(async ([p, j]) => {
        if (cancelled) return;
        if (!p.ok || !j.ok) throw new Error();
        setProjects(unwrapList<Project>(await p.json()));
        setJobs(unwrapList<ImportJob>(await j.json()));
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load imports.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canImport]);


  return (
    <>
      <Header title="Imports" description="Bring in old WhatsApp chats and support history" />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
        {!canImport ? (
          loaded && <p className="text-sm text-helplus-text-light">Ask an admin or supervisor to run imports</p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <UploadCard
                kind="whatsapp"
                title="WhatsApp chat"
                accept=".txt,.zip"
                note="Export the chat from WhatsApp (with or without media). Up to 50 MB. Bigger chats: export without media or in parts."
                projects={projects}
              />
              <UploadCard
                kind="csv"
                title="Old system (CSV)"
                accept=".csv"
                note="Save the export as CSV first. Up to 50 MB."
                projects={projects}
              />
            </div>
            <section className="space-y-2">
              <h3 className="text-sm font-medium text-helplus-text">Recent imports</h3>
              {loadError && <p className="text-sm text-helplus-danger">{loadError}</p>}
              {loading ? (
                <p className="text-sm text-helplus-text-light">Loading…</p>
              ) : jobs.length === 0 ? (
                <p className="text-sm text-helplus-text-light">No imports yet.</p>
              ) : (
                <JobList jobs={jobs} projects={projects} />
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function UploadCard({
  kind,
  title,
  accept,
  note,
  projects,
}: {
  kind: "whatsapp" | "csv";
  title: string;
  accept: string;
  note: string;
  projects: Project[];
}) {
  const router = useRouter();
  const active = projects.filter((p) => !p.archived);
  const [projectId, setProjectId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const Icon = kind === "whatsapp" ? MessageCircle : FileSpreadsheet;
  // the list comes back with the default project first
  const chosen = projectId || active[0]?.id || "";

  const upload = async () => {
    if (!file || !chosen) return;
    setBusy(true);
    setError("");
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("projectId", chosen);
    fd.append("file", file);
    try {
      const res = await fetch("/api/imports", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorText(json, "Upload failed."));
        setBusy(false);
        return;
      }
      router.push(`/imports/${json.id}`);
    } catch {
      setError("Upload failed. Check your connection.");
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-helplus-border bg-helplus-surface p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-helplus-text-light" />
        <h3 className="text-sm font-semibold text-helplus-text">{title}</h3>
      </div>
      <p className="text-xs text-helplus-text-light">{note}</p>
      <label className="block">
        <span className="block text-xs font-medium text-helplus-text-light mb-1">Project</span>
        <select
          value={chosen}
          onChange={(e) => setProjectId(e.target.value)}
          className="w-full h-9 rounded-md border border-helplus-border bg-helplus-surface px-2 text-sm text-helplus-text"
        >
          {active.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-helplus-text-light mb-1">File</span>
        <input
          type="file"
          accept={accept}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError("");
          }}
          className="block w-full text-sm text-helplus-text file:mr-3 file:h-8 file:px-3 file:rounded-md file:border file:border-helplus-border file:bg-helplus-bg file:text-helplus-text"
        />
      </label>
      {error && <p className="text-sm text-helplus-danger">{error}</p>}
      <button
        onClick={upload}
        disabled={busy || !file || !chosen}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {busy ? "Uploading…" : "Upload"}
      </button>
    </div>
  );
}

function JobList({ jobs, projects }: { jobs: ImportJob[]; projects: Project[] }) {
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "";
  return (
    <div className="rounded-md border border-helplus-border bg-helplus-surface divide-y divide-helplus-border">
      {jobs.map((j) => (
        <Link
          key={j.id}
          href={`/imports/${j.id}`}
          className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 py-3 text-sm hover:bg-helplus-bg"
        >
          <span className="flex items-center gap-2 min-w-0 sm:flex-1">
            <StatusDot status={j.status} />
            <span className="truncate text-helplus-text">{j.fileName || "Untitled"}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-helplus-text-light pl-4 sm:pl-0">
            <span>{KIND_LABELS[j.kind] ?? j.kind}</span>
            <span className={cn(!projectName(j.projectId) && "hidden")}>{projectName(j.projectId)}</span>
            {(j.status === "done" || j.status === "running") && (
              <span>
                {j.stats.created ?? 0} created, {j.stats.skipped ?? 0} skipped
              </span>
            )}
            <span>{formatWhen(j.createdAt)}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
