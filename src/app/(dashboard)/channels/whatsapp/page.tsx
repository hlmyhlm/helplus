"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Loader2, MessagesSquare, X } from "lucide-react";
import { Header } from "@/components/layout/header";
import { unwrapList } from "@/lib/api-client";
import { useCompany } from "@/lib/hooks/use-company";
import { hasPermission } from "@/lib/rbac";

interface Chat {
  id: string;
  name: string;
  isGroup: boolean;
  projectId: string | null;
  projectName: string | null;
  lastMessageAt: string | null;
}

interface Pick {
  id: string;
  chatName: string;
  senderName: string;
  text: string;
  at: string;
  options: { ticketId: string; number: number; title: string; status: string }[];
}

interface Sender {
  name: string;
  staff: boolean;
  fromTeam: boolean;
}

interface Project {
  id: string;
  name: string;
  archived: boolean;
}

const TITLE = "WhatsApp groups";
const DESCRIPTION = "Link each group to a client so its messages become tickets";

const btn =
  "inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg transition-colors disabled:opacity-50";
const select =
  "h-9 px-3 text-sm rounded-lg border border-helplus-border bg-helplus-surface text-helplus-text w-full sm:w-64 min-w-0";

async function errorText(res: Response): Promise<string> {
  if (res.status === 403) return "You don't have permission to do that.";
  const body = await res.json().catch(() => null);
  const e = body?.error;
  return (typeof e === "string" ? e : e?.message) || "Something went wrong. Try again.";
}

function when(iso: string | null): string {
  if (!iso) return "No messages yet";
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function PickCard({ pick, canPlace, onDone }: { pick: Pick; canPlace: boolean; onDone: (error?: string) => void }) {
  const [ticketId, setTicketId] = useState(pick.options[0]?.ticketId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function place(target: string | null) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/bot/picks/${pick.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: target }),
      });
      if (res.status === 409) return onDone(await errorText(res));
      if (!res.ok) return setError(await errorText(res));
      onDone();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-helplus-surface rounded-xl border border-helplus-border p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-helplus-text-light">
        <span className="font-semibold text-helplus-text">{pick.chatName}</span>
        <span>{pick.senderName}</span>
        <span>{when(pick.at)}</span>
      </div>
      <p className="mt-2 text-sm text-helplus-text whitespace-pre-wrap break-words line-clamp-3">{pick.text}</p>

      {error && <p className="mt-2 text-xs text-helplus-danger">{error}</p>}

      {canPlace && (
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
          {pick.options.length > 0 ? (
            <>
              <select
                value={ticketId}
                onChange={(e) => setTicketId(e.target.value)}
                disabled={busy}
                aria-label="Ticket"
                className={select}
              >
                {pick.options.map((o) => (
                  <option key={o.ticketId} value={o.ticketId}>
                    #{o.number} {o.title}
                  </option>
                ))}
              </select>
              <button
                onClick={() => place(ticketId)}
                disabled={busy || !ticketId}
                className={`${btn} text-white bg-helplus-primary hover:bg-helplus-primary-dark`}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Place
              </button>
            </>
          ) : (
            <span className="text-xs text-helplus-text-light">No open tickets in this group.</span>
          )}
          <button
            onClick={() => place(null)}
            disabled={busy}
            className={`${btn} text-helplus-text border border-helplus-border hover:bg-helplus-bg`}
          >
            <X className="h-3.5 w-3.5" />
            Not a reply
          </button>
        </div>
      )}
    </div>
  );
}

function SenderList({ chatId }: { chatId: string }) {
  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bot/senders?chatId=${encodeURIComponent(chatId)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(await errorText(res));
          setSenders([]);
          return;
        }
        setSenders(unwrapList<Sender>(await res.json()));
      })
      .catch(() => {
        if (!cancelled) {
          setError("Couldn't load senders.");
          setSenders([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  async function toggle(name: string, staff: boolean) {
    setSaving(name);
    setError("");
    try {
      const res = await fetch("/api/bot/senders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, staff }),
      });
      if (!res.ok) {
        setError(await errorText(res));
        return;
      }
      setSenders((list) => list?.map((s) => (s.name === name ? { ...s, staff } : s)) ?? null);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="mt-3 rounded-lg bg-helplus-bg p-3 space-y-2">
      <p className="text-xs text-helplus-text-light">
        Staff applies to everyone with that WhatsApp name. Senders show up once the group is linked, so tick
        staff right after linking. Until then, staff messages count as client messages.
      </p>
      {error && <p className="text-xs text-helplus-danger">{error}</p>}
      {senders === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-helplus-text-light" />
      ) : senders.length === 0 ? (
        <p className="text-xs text-helplus-text-light">No senders in the last 30 days.</p>
      ) : (
        <ul className="divide-y divide-helplus-border">
          {senders.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-helplus-text break-words min-w-0">{s.name}</span>
              <label className="flex items-center gap-2 text-xs text-helplus-text flex-shrink-0">
                {s.fromTeam && <span className="text-helplus-text-light">From Team</span>}
                <input
                  type="checkbox"
                  checked={s.staff}
                  disabled={s.fromTeam || saving === s.name}
                  onChange={(e) => toggle(s.name, e.target.checked)}
                />
                Staff
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChatRow({ chat, projects, projectWord }: { chat: Chat; projects: Project[]; projectWord: string }) {
  const [projectId, setProjectId] = useState(chat.projectId ?? "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);

  const active = projects.filter((p) => !p.archived);
  // keep a link to an archived project visible
  const current = projects.find((p) => p.id === projectId && p.archived);

  async function link(next: string) {
    const before = projectId;
    setProjectId(next);
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/bot/chats/${chat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: next || null }),
      });
      if (!res.ok) {
        setProjectId(before);
        setNote({ ok: false, text: await errorText(res) });
        return;
      }
      setNote({ ok: true, text: "Saved" });
    } catch {
      setProjectId(before);
      setNote({ ok: false, text: "Couldn't reach the server. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-helplus-surface rounded-xl border border-helplus-border p-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-helplus-text break-words">{chat.name}</p>
          <p className="mt-0.5 text-xs text-helplus-text-light">
            {chat.isGroup ? "Group" : "Private chat"} · {when(chat.lastMessageAt)}
          </p>
        </div>
        <div className="flex flex-col gap-1 sm:items-end">
          <select
            value={projectId}
            onChange={(e) => link(e.target.value)}
            disabled={busy}
            aria-label={projectWord}
            className={select}
          >
            <option value="">Not linked</option>
            {current && <option value={current.id}>{current.name} (archived)</option>}
            {active.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {note && (
            <span className={`text-xs ${note.ok ? "text-helplus-success" : "text-helplus-danger"}`}>{note.text}</span>
          )}
        </div>
      </div>

      {!projectId && (
        <p className="mt-2 text-xs text-helplus-warning">Messages are ignored until you link this group</p>
      )}

      <button
        onClick={() => setOpen(!open)}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-helplus-link hover:underline"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Senders
      </button>
      {open && <SenderList chatId={chat.id} />}
    </div>
  );
}

export default function WhatsAppGroupsPage() {
  const { projectLabel } = useCompany();
  const projectWord = projectLabel === "Projects" ? "Project" : "Client";
  const [chats, setChats] = useState<Chat[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pickError, setPickError] = useState("");
  const [canPlace, setCanPlace] = useState(false);

  // placing a reply also needs tickets:update
  useEffect(() => {
    fetch("/api/auth")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCanPlace(hasPermission(d?.user?.role ?? "", "tickets:update")))
      .catch(() => setCanPlace(false));
  }, []);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [c, p, pr] = await Promise.all([
        fetch("/api/bot/chats"),
        fetch("/api/bot/picks"),
        fetch("/api/projects?archived=1"),
      ]);
      const bad = [c, p, pr].find((r) => !r.ok);
      if (bad) {
        setLoadError(await errorText(bad));
        return;
      }
      const list = unwrapList<Chat>(await c.json());
      // not linked first, otherwise keep the newest first order
      setChats([...list.filter((x) => !x.projectId), ...list.filter((x) => x.projectId)]);
      setPicks(unwrapList<Pick>(await p.json()));
      setProjects(unwrapList<Project>(await pr.json()));
    } catch {
      setLoadError("Couldn't load groups. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function pickDone(error?: string) {
    setPickError(error ?? "");
    load();
  }

  return (
    <>
      <Header title={TITLE} description={DESCRIPTION} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <Link
            href="/channels"
            className="inline-flex items-center gap-1 text-sm font-medium text-helplus-link hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Channels
          </Link>

          {loadError && <p className="text-sm text-helplus-danger">{loadError}</p>}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-helplus-text-light" />
            </div>
          ) : loadError ? null : (
            <>
              {(picks.length > 0 || pickError) && (
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold text-helplus-text">Replies to place</h2>
                  {pickError && <p className="text-sm text-helplus-danger">{pickError}</p>}
                  {picks.map((p) => (
                    <PickCard key={p.id} pick={p} canPlace={canPlace} onDone={pickDone} />
                  ))}
                </section>
              )}

              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-helplus-text">Groups</h2>
                {chats.length === 0 ? (
                  <div className="text-center py-12">
                    <MessagesSquare className="h-10 w-10 mx-auto mb-3 text-helplus-text-light opacity-40" />
                    <p className="text-sm text-helplus-text-light">
                      No groups yet. Add the bot number to a WhatsApp group.
                    </p>
                  </div>
                ) : (
                  chats.map((c) => <ChatRow key={c.id} chat={c} projects={projects} projectWord={projectWord} />)
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
