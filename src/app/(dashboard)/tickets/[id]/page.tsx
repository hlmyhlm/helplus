"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Header } from "@/components/layout/header";
import { formatRelativeTime } from "@/lib/utils";
import { unwrapList } from "@/lib/api-client";
import { StatusDot, sourceLabel } from "@/components/tickets/status-dot";
import { STATUS_LABELS, TICKET_STATUSES } from "@/lib/tickets/status";

interface Msg {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}
interface Note {
  id: string;
  content: string;
  authorName: string;
  createdAt: string;
}
interface Ticket {
  id: string;
  number: number;
  title: string;
  status: string;
  source: string;
  category: string;
  priority: string;
  createdAt: string;
  project: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  conversation: { customerName: string; customerContact: string; messages: Msg[]; notes: Note[] } | null;
}
interface Person {
  id: string;
  name: string;
  role: string;
}

const WHO: Record<string, string> = { customer: "Client", agent: "Support", assistant: "AI", system: "System" };

export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [missing, setMissing] = useState(false);
  const [staff, setStaff] = useState<Person[]>([]);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/tickets/${id}`);
    if (!res.ok) {
      setMissing(true);
      return;
    }
    setTicket(await res.json());
  }, [id]);

  useEffect(() => {
    load();
    fetch("/api/admin/users?limit=100")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setStaff(unwrapList<Person>(d).filter((p) => p.role !== "viewer" && p.role !== "client")))
      .catch(() => setStaff([]));
  }, [load]);

  const patch = async (body: Record<string, unknown>) => {
    setError("");
    const res = await fetch(`/api/tickets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't save");
    await load();
  };

  const send = async (markAnswered: boolean) => {
    if (!reply.trim()) return;
    setError("");
    const res = await fetch(`/api/tickets/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: reply, markAnswered }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Couldn't send");
      return;
    }
    if (markAnswered) await navigator.clipboard?.writeText(reply).catch(() => undefined);
    setReply("");
    await load();
  };

  const addNote = async () => {
    if (!note.trim()) return;
    await fetch(`/api/tickets/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: note }),
    });
    setNote("");
    await load();
  };

  if (missing) {
    return (
      <>
        <Header title="Ticket not found" />
        <div className="p-6 text-sm text-helplus-text-light">
          It doesn&apos;t exist, or it&apos;s in a project you can&apos;t see.{" "}
          <Link href="/tickets" className="text-helplus-link">
            Back to tickets
          </Link>
        </div>
      </>
    );
  }
  if (!ticket) return <div className="p-6 text-sm text-helplus-text-light">Loading…</div>;

  const box = "w-full rounded-md border border-helplus-border bg-helplus-surface px-3 py-2 text-sm text-helplus-text";
  // long titles wrap the header into many lines on a phone, so cap it there
  const headerTitle = ticket.title.length > 60 ? `${ticket.title.slice(0, 57)}...` : ticket.title;

  return (
    <>
      <Header
        title={`#${ticket.number} ${headerTitle}`}
        description={`${sourceLabel(ticket.source)} · ${ticket.project.name}`}
        actions={
          <Link href="/tickets" className="inline-flex items-center gap-1 h-9 px-3 rounded-md border border-helplus-border text-sm text-helplus-text">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4 items-start">
          <div className="space-y-4">
            {ticket.conversation?.messages.map((m) => (
              <div key={m.id} className="flex gap-3">
                <div className="h-7 w-7 shrink-0 rounded-full bg-helplus-primary-50 text-helplus-link text-[11px] font-semibold grid place-items-center">
                  {(WHO[m.role] ?? m.role).slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="text-xs text-helplus-text-light">
                    <span className="font-semibold text-helplus-text">{m.role === "customer" ? ticket.conversation?.customerName : WHO[m.role] ?? m.role}</span>{" "}
                    · {formatRelativeTime(m.createdAt)}
                  </div>
                  <div className="text-sm text-helplus-text whitespace-pre-wrap">{m.content}</div>
                </div>
              </div>
            ))}
            {ticket.status !== "closed" && (
              <div className="space-y-2">
                <textarea className={box} rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write the reply you'll send to the client…" />
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => send(true)} className="h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium">
                    Copy and mark answered
                  </button>
                  <button onClick={() => send(false)} className="h-9 px-3 rounded-md border border-helplus-border text-sm text-helplus-text">
                    Save reply only
                  </button>
                </div>
              </div>
            )}
            {error && <p className="text-sm text-helplus-danger">{error}</p>}
          </div>

          <div className="space-y-4">
            <div className="rounded-md border border-helplus-border bg-helplus-surface p-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs text-helplus-text-light">Status</span>
                <StatusDot status={ticket.status} />
              </div>
              <select className={box} value="" onChange={(e) => e.target.value && patch({ status: e.target.value })}>
                <option value="">Move to…</option>
                {TICKET_STATUSES.filter((s) => s !== ticket.status).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <label className="block text-xs text-helplus-text-light">Handled by</label>
              <select className={box} value={ticket.assignee?.id ?? ""} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
                <option value="">Unassigned</option>
                {staff.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="flex justify-between">
                <span className="text-xs text-helplus-text-light">Client</span>
                <span className="text-helplus-text">{ticket.conversation?.customerName ?? "Unknown"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-helplus-text-light">Opened</span>
                <span className="text-helplus-text">{formatRelativeTime(ticket.createdAt)}</span>
              </div>
            </div>
            <div className="rounded-md border border-helplus-border bg-helplus-surface p-4 space-y-2">
              <h3 className="text-sm font-semibold text-helplus-text">Internal notes</h3>
              <textarea className={box} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Only staff see this" />
              <button onClick={addNote} className="h-8 px-3 rounded-md border border-helplus-border text-xs text-helplus-text">
                Add note
              </button>
              {ticket.conversation?.notes.map((n) => (
                <div key={n.id} className="text-xs border-t border-helplus-border pt-2">
                  <div className="text-helplus-text whitespace-pre-wrap">{n.content}</div>
                  <div className="text-helplus-text-light">
                    {n.authorName} · {formatRelativeTime(n.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
