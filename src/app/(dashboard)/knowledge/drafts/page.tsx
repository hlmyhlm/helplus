"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Inbox, Loader2, Pencil, Trash2, X } from "lucide-react";
import { Header } from "@/components/layout/header";
import { unwrapList, listMeta } from "@/lib/api-client";
import { useCompany } from "@/lib/hooks/use-company";
import { hasPermission } from "@/lib/rbac";
import { useRole } from "@/lib/hooks/use-role";

interface Draft {
  id: string;
  title: string;
  content: string;
  projectId: string | null;
  project: { name: string } | null;
  sourceTicketId: string | null;
  sourceTicket: { number: number } | null;
  createdAt: string;
}

const TITLE = "Waiting approval";
const DESCRIPTION = "Answers from imports. Approve the good ones so the AI can use them.";

export default function DraftsPage() {
  return (
    <Suspense
      fallback={
        <>
          <Header title={TITLE} description={DESCRIPTION} />
          <div className="flex-1 overflow-y-auto p-4 md:p-6 text-sm text-helplus-text-light">
            Loading…
          </div>
        </>
      }
    >
      <DraftsPageInner />
    </Suspense>
  );
}

// imported drafts are "Q: ...\n\nA: ..."
function splitQA(content: string): { q: string; a: string } | null {
  const m = content.match(/^Q:\s*([\s\S]*?)\n\nA:\s*([\s\S]*)$/);
  return m ? { q: m[1], a: m[2] } : null;
}

async function errorText(res: Response): Promise<string> {
  if (res.status === 403) return "You don't have permission to do that.";
  const body = await res.json().catch(() => null);
  const e = body?.error;
  return (typeof e === "string" ? e : e?.message) || "Something went wrong. Try again.";
}

function Clamped({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.split("\n").length > 6 || text.length > 360;
  return (
    <div>
      <p className="text-xs font-semibold text-helplus-text-light mb-1">{label}</p>
      <p
        className={`text-sm text-helplus-text whitespace-pre-wrap break-words ${open ? "" : "line-clamp-6"}`}
      >
        {text}
      </p>
      {long && (
        <button
          onClick={() => setOpen(!open)}
          className="mt-1 text-xs font-medium text-helplus-link hover:underline"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

interface Can {
  update: boolean;
  remove: boolean;
}

function DraftCard({
  draft,
  projectWord,
  can,
  onGone,
}: {
  draft: Draft;
  projectWord: string;
  can: Can;
  onGone: () => void;
}) {
  const [current, setCurrent] = useState(draft);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.content);
  const [confirmReject, setConfirmReject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(method: "PATCH" | "POST", body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/knowledge/drafts/${current.id}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await errorText(res));
        return null;
      }
      return await res.json();
    } catch {
      setError("Couldn't reach the server. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    const saved = await send("PATCH", { title, content });
    if (saved) {
      setCurrent({ ...current, title: saved.title, content: saved.content });
      setEditing(false);
    }
  }

  async function approve() {
    if (await send("POST", { action: "approve" })) onGone();
  }

  async function reject() {
    if (await send("POST", { action: "reject" })) onGone();
  }

  const qa = splitQA(current.content);
  const btn =
    "inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg transition-colors disabled:opacity-50";

  return (
    <div className="bg-helplus-surface rounded-xl border border-helplus-border p-4">
      {editing ? (
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            aria-label="Title"
            className="w-full h-9 px-3 text-sm rounded-lg border border-helplus-border bg-helplus-surface text-helplus-text focus:outline-none focus:ring-2 focus:ring-helplus-primary/30"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={busy}
            aria-label="Content"
            rows={10}
            className="w-full px-3 py-2 text-sm rounded-lg border border-helplus-border bg-helplus-surface text-helplus-text focus:outline-none focus:ring-2 focus:ring-helplus-primary/30"
          />
        </div>
      ) : (
        <>
          <h3 className="text-sm font-semibold text-helplus-text break-words">{current.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-helplus-text-light">
            {current.sourceTicketId && (
              <Link
                href={`/tickets/${current.sourceTicketId}`}
                className="text-helplus-link hover:underline"
              >
                From ticket #{current.sourceTicket?.number ?? "?"}
              </Link>
            )}
            {current.project && (
              <span>
                {projectWord}: {current.project.name}
              </span>
            )}
          </div>
          <div className="mt-3 space-y-3">
            {qa ? (
              <>
                <Clamped label="Q" text={qa.q} />
                <Clamped label="A" text={qa.a} />
              </>
            ) : (
              <Clamped label="Answer" text={current.content} />
            )}
          </div>
        </>
      )}

      {error && <p className="mt-3 text-xs text-helplus-danger">{error}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <button
              onClick={save}
              disabled={busy}
              className={`${btn} text-white bg-helplus-primary hover:bg-helplus-primary-dark`}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Save
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setTitle(current.title);
                setContent(current.content);
                setError("");
              }}
              disabled={busy}
              className={`${btn} text-helplus-text border border-helplus-border hover:bg-helplus-bg`}
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          </>
        ) : confirmReject ? (
          <>
            <span className="text-xs text-helplus-text">Reject and delete this answer?</span>
            <button
              onClick={reject}
              disabled={busy}
              className={`${btn} text-white bg-red-600 hover:bg-red-700`}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Yes, reject
            </button>
            <button
              onClick={() => setConfirmReject(false)}
              disabled={busy}
              className={`${btn} text-helplus-text border border-helplus-border hover:bg-helplus-bg`}
            >
              Keep
            </button>
          </>
        ) : (
          <>
            {can.update && (
              <>
                <button
                  onClick={approve}
                  disabled={busy}
                  className={`${btn} text-white bg-helplus-primary hover:bg-helplus-primary-dark`}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Approve
                </button>
                <button
                  onClick={() => {
                    setEditing(true);
                    setError("");
                  }}
                  disabled={busy}
                  className={`${btn} text-helplus-text border border-helplus-border hover:bg-helplus-bg`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
              </>
            )}
            {can.remove && (
              <button
                onClick={() => {
                  setConfirmReject(true);
                  setError("");
                }}
                disabled={busy}
                className={`${btn} text-helplus-danger border border-helplus-border hover:bg-helplus-bg`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Reject
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function DraftsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("projectId") ?? "";
  const { projectLabel } = useCompany();
  const projectWord = projectLabel === "Projects" ? "Project" : "Client";
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  // buttons follow the same permissions the api checks
  const role = useRole();
  const can: Can = {
    update: hasPermission(role, "knowledge:update"),
    remove: hasPermission(role, "knowledge:update") && hasPermission(role, "knowledge:delete"),
  };

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setProjects(d ? unwrapList<{ id: string; name: string }>(d) : []))
      .catch(() => setProjects([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const params = new URLSearchParams({ page: String(page) });
    if (projectId) params.set("projectId", projectId);
    try {
      const res = await fetch(`/api/knowledge/drafts?${params}`);
      if (!res.ok) {
        setDrafts([]);
        setLoadError(await errorText(res));
        return;
      }
      const json = await res.json();
      setDrafts(unwrapList<Draft>(json));
      const meta = listMeta(json);
      setPages(Math.max(1, meta?.totalPages ?? 1));
      setTotal(meta?.total ?? 0);
    } catch {
      setDrafts([]);
      setLoadError("Couldn't load drafts. Try again.");
    } finally {
      setLoading(false);
    }
  }, [page, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  function pickProject(id: string) {
    setPage(1);
    router.replace(
      id ? `/knowledge/drafts?projectId=${encodeURIComponent(id)}` : "/knowledge/drafts"
    );
  }

  // reload so the page refills, and step back when the last page empties
  function gone() {
    if (drafts.length === 1 && page > 1) setPage(page - 1);
    else load();
  }

  return (
    <>
      <Header title={TITLE} description={DESCRIPTION} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <select
              value={projectId}
              onChange={(e) => pickProject(e.target.value)}
              aria-label={projectWord}
              className="h-9 px-3 text-sm rounded-lg border border-helplus-border bg-helplus-surface text-helplus-text max-w-full"
            >
              <option value="">All {projectLabel.toLowerCase()}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {!loading && !loadError && (
              <span className="text-xs text-helplus-text-light">{total} waiting</span>
            )}
          </div>

          {loadError && <p className="text-sm text-helplus-danger">{loadError}</p>}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-helplus-text-light" />
            </div>
          ) : !loadError && drafts.length === 0 ? (
            <div className="text-center py-12">
              <Inbox className="h-10 w-10 mx-auto mb-3 text-helplus-text-light opacity-40" />
              <p className="text-sm text-helplus-text-light">
                Nothing waiting. Imported answers show up here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {drafts.map((d) => (
                <DraftCard key={d.id} draft={d} projectWord={projectWord} can={can} onGone={gone} />
              ))}
            </div>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button
                disabled={page <= 1 || loading}
                onClick={() => setPage(page - 1)}
                className="h-8 px-3 rounded-md border border-helplus-border text-helplus-text disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-helplus-text-light">
                {page} / {pages}
              </span>
              <button
                disabled={page >= pages || loading}
                onClick={() => setPage(page + 1)}
                className="h-8 px-3 rounded-md border border-helplus-border text-helplus-text disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
