"use client";

import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { unwrapList } from "@/lib/api-client";

interface Project {
  id: string;
  name: string;
  isDefault: boolean;
}

export function QuickAddDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}) {
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        const list = unwrapList<Project>(d);
        setProjects(list);
        setProjectId((cur) => cur || list.find((p) => p.isDefault)?.id || list[0]?.id || "");
      })
      .catch(() => setProjects([]));
  }, [open]);

  if (!open) return null;

  const suggest = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tickets/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = await res.json().catch(() => ({}));
      if (d.title) setTitle(d.title);
      if (d.category) setCategory(d.category);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setError("");
    if (!text.trim()) {
      setError("Paste or type the issue first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          title: title || undefined,
          category: category || undefined,
          customerName: customerName || undefined,
          projectId: projectId || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(typeof d.error === "string" ? d.error : "Couldn't create the ticket.");
        return;
      }
      const ticket = await res.json();
      setText("");
      setTitle("");
      setCategory("");
      setCustomerName("");
      onCreated(ticket.id);
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded-md border border-helplus-border bg-helplus-surface px-3 py-2 text-sm text-helplus-text focus:outline-none focus:ring-2 focus:ring-helplus-primary/30";

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full md:max-w-xl rounded-t-xl md:rounded-lg bg-helplus-surface border border-helplus-border p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-helplus-text">Quick add</h3>
          <button onClick={onClose} aria-label="Close" className="p-1 text-helplus-text-light">
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className="block text-xs text-helplus-text-light">Paste the message</label>
        <textarea
          className={field}
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the WhatsApp message here. IC numbers are hidden automatically."
        />
        <div className="flex justify-end">
          <button
            onClick={suggest}
            disabled={busy || !text.trim()}
            className="inline-flex items-center gap-1.5 text-sm text-helplus-link disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" /> Suggest title and category
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className={field} placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className={field} placeholder="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input className={field} placeholder="Client name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          <select className={field} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-helplus-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="h-10 px-4 rounded-md border border-helplus-border text-sm text-helplus-text">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="h-10 px-4 rounded-md bg-helplus-primary text-white text-sm font-medium disabled:opacity-60"
          >
            Create ticket
          </button>
        </div>
      </div>
    </div>
  );
}
