"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { Plus, X, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { unwrapList } from "@/lib/api-client";
import { formatMins } from "@/lib/sla/format";

interface Project {
  id: string;
  name: string;
}

interface SLARule {
  id: string;
  name: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  priority: string;
  category: string;
  source: string;
  firstResponseMins: number;
  resolutionMins: number;
  isActive: boolean;
}

const priorityOptions = [
  { value: "all", label: "All priorities" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const sourceOptions = [
  { value: "all", label: "All sources" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "sms", label: "SMS" },
  { value: "telegram", label: "Telegram" },
  { value: "web_form", label: "Web form" },
  { value: "quick_add", label: "Quick add" },
];

const label = (options: { value: string; label: string }[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;

interface FormState {
  name: string;
  projectId: string;
  priority: string;
  category: string;
  source: string;
  firstAmount: number;
  firstUnit: "minutes" | "hours";
  solveAmount: number;
  solveUnit: "minutes" | "hours";
  isActive: boolean;
}

const defaultForm: FormState = {
  name: "",
  projectId: "all",
  priority: "all",
  category: "",
  source: "all",
  firstAmount: 30,
  firstUnit: "minutes",
  solveAmount: 8,
  solveUnit: "hours",
  isActive: true,
};

function toForm(rule: SLARule): FormState {
  const split = (mins: number) =>
    mins >= 60 && mins % 60 === 0
      ? { amount: mins / 60, unit: "hours" as const }
      : { amount: mins, unit: "minutes" as const };
  const first = split(rule.firstResponseMins);
  const solve = split(rule.resolutionMins);
  return {
    name: rule.name,
    projectId: rule.projectId ?? "all",
    priority: rule.priority,
    category: rule.category === "all" ? "" : rule.category,
    source: rule.source,
    firstAmount: first.amount,
    firstUnit: first.unit,
    solveAmount: solve.amount,
    solveUnit: solve.unit,
    isActive: rule.isActive,
  };
}

function toMins(amount: number, unit: "minutes" | "hours") {
  return unit === "hours" ? amount * 60 : amount;
}

export default function SLAPage() {
  const [rules, setRules] = useState<SLARule[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadError, setLoadError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SLARule | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const [rulesRes, projectsRes] = await Promise.all([
        fetch("/api/sla?limit=100"),
        fetch("/api/projects"),
      ]);
      if (rulesRes.ok) setRules(unwrapList<SLARule>(await rulesRes.json()));
      else setLoadError("Couldn't load SLA rules.");
      if (projectsRes.ok) setProjects(unwrapList<Project>(await projectsRes.json()));
    } catch {
      setLoadError("Couldn't load SLA rules.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(defaultForm);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (rule: SLARule) => {
    setEditing(rule);
    setForm(toForm(rule));
    setFormError("");
    setModalOpen(true);
  };

  const save = async () => {
    setFormError("");
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        projectId: form.projectId === "all" ? null : form.projectId,
        priority: form.priority,
        category: form.category.trim() || "all",
        source: form.source,
        firstResponseMins: toMins(form.firstAmount, form.firstUnit),
        resolutionMins: toMins(form.solveAmount, form.solveUnit),
        isActive: form.isActive,
      };
      const url = editing ? `/api/sla/${editing.id}` : "/api/sla";
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setFormError((await res.json().catch(() => ({}))).error ?? "Couldn't save");
        return;
      }
      setModalOpen(false);
      await load();
    } catch {
      setFormError("Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rule: SLARule) => {
    try {
      const res = await fetch(`/api/sla/${rule.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !rule.isActive }),
      });
      if (res.ok) await load();
    } catch {
      // next load will show the real state
    }
  };

  const remove = async (id: string) => {
    setDeleteError("");
    try {
      const res = await fetch(`/api/sla/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setDeleteError((await res.json().catch(() => ({}))).error ?? "Couldn't delete");
        return;
      }
      setDeleteId(null);
      await load();
    } catch {
      setDeleteError("Couldn't delete");
    }
  };

  const chips = (rule: SLARule) => {
    const items: string[] = [rule.project?.name ?? "All clients"];
    if (rule.priority !== "all") items.push(label(priorityOptions, rule.priority));
    if (rule.category && rule.category !== "all") items.push(rule.category);
    if (rule.source !== "all") items.push(label(sourceOptions, rule.source));
    return items;
  };

  return (
    <>
      <Header
        title="SLA rules"
        description="How fast tickets should get a first reply and be solved"
        actions={
          <button
            onClick={openCreate}
            className="flex items-center gap-2 h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Add rule
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {loadError && <p className="text-sm text-helplus-danger">{loadError}</p>}

        {!rules.length && !loadError && (
          <div className="rounded-md border border-helplus-border bg-helplus-surface p-6 text-center text-sm text-helplus-text-light">
            No SLA rules yet. Add one to start timing tickets.
          </div>
        )}

        {!!rules.length && (
          <>
            {/* desktop table */}
            <div className="hidden md:block rounded-md border border-helplus-border bg-helplus-surface overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-helplus-border text-left text-xs text-helplus-text-light">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Applies to</th>
                    <th className="px-4 py-2 font-medium">First reply</th>
                    <th className="px-4 py-2 font-medium">Solve within</th>
                    <th className="px-4 py-2 font-medium">Active</th>
                    <th className="px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-helplus-border">
                  {rules.map((rule) => (
                    <tr key={rule.id}>
                      <td className="px-4 py-3 text-helplus-text font-medium">{rule.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {chips(rule).map((c, i) => (
                            <span key={i} className="px-2 py-0.5 rounded text-xs bg-helplus-primary-50 text-helplus-link">
                              {c}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-helplus-text">{formatMins(rule.firstResponseMins)}</td>
                      <td className="px-4 py-3 text-helplus-text">{formatMins(rule.resolutionMins)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => toggleActive(rule)}
                          className={cn(
                            "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                            rule.isActive ? "bg-helplus-success" : "bg-helplus-border"
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                              rule.isActive ? "translate-x-4.5" : "translate-x-1"
                            )}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(rule)} className="p-1.5 hover:bg-helplus-primary-50 rounded-lg">
                            <Pencil className="h-3.5 w-3.5 text-helplus-text-light" />
                          </button>
                          <button onClick={() => setDeleteId(rule.id)} className="p-1.5 hover:bg-helplus-primary-50 rounded-lg">
                            <Trash2 className="h-3.5 w-3.5 text-helplus-text-light" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* phone cards */}
            <div className="md:hidden space-y-3">
              {rules.map((rule) => (
                <div key={rule.id} className="rounded-md border border-helplus-border bg-helplus-surface p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-helplus-text">{rule.name}</h3>
                    <button
                      onClick={() => toggleActive(rule)}
                      className={cn(
                        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0",
                        rule.isActive ? "bg-helplus-success" : "bg-helplus-border"
                      )}
                    >
                      <span
                        className={cn(
                          "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                          rule.isActive ? "translate-x-4.5" : "translate-x-1"
                        )}
                      />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {chips(rule).map((c, i) => (
                      <span key={i} className="px-2 py-0.5 rounded text-xs bg-helplus-primary-50 text-helplus-link">
                        {c}
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-4 text-xs text-helplus-text-light">
                    <span>First reply: <span className="text-helplus-text">{formatMins(rule.firstResponseMins)}</span></span>
                    <span>Solve within: <span className="text-helplus-text">{formatMins(rule.resolutionMins)}</span></span>
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <button onClick={() => openEdit(rule)} className="text-xs text-helplus-link">Edit</button>
                    <button onClick={() => setDeleteId(rule.id)} className="text-xs text-helplus-danger">Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="text-xs text-helplus-text-light">
          Most specific rule wins: client, then priority, category, source. Changes apply to new tickets and to
          tickets whose details change.
        </p>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setModalOpen(false)} />
          <div className="relative w-full md:max-w-md md:mx-4 bg-helplus-surface rounded-t-xl md:rounded-xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-helplus-border">
              <h3 className="font-semibold text-helplus-text text-lg">{editing ? "Edit SLA rule" : "Add SLA rule"}</h3>
              <button onClick={() => setModalOpen(false)} className="p-1.5 hover:bg-helplus-primary-50 rounded-lg">
                <X className="h-5 w-5 text-helplus-text-light" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-helplus-text mb-1">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Urgent"
                  className="w-full text-sm px-3 py-2 border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-helplus-text mb-1">Project</label>
                <select
                  value={form.projectId}
                  onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                  className="w-full text-sm px-3 py-2 border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text"
                >
                  <option value="all">All clients</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-helplus-text mb-1">Priority</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                    className="w-full text-sm px-3 py-2 border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text"
                  >
                    {priorityOptions.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-helplus-text mb-1">Source</label>
                  <select
                    value={form.source}
                    onChange={(e) => setForm({ ...form, source: e.target.value })}
                    className="w-full text-sm px-3 py-2 border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text"
                  >
                    {sourceOptions.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-helplus-text mb-1">Category</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Empty means all categories"
                  className="w-full text-sm px-3 py-2 border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-helplus-text mb-1">First reply</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={form.firstAmount}
                      onChange={(e) => setForm({ ...form, firstAmount: parseInt(e.target.value) || 1 })}
                      className="w-full text-sm px-3 py-2 border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text"
                    />
                    <select
                      value={form.firstUnit}
                      onChange={(e) => setForm({ ...form, firstUnit: e.target.value as "minutes" | "hours" })}
                      className="text-sm px-2 py-2 border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text"
                    >
                      <option value="minutes">min</option>
                      <option value="hours">hr</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-helplus-text mb-1">Solve within</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min={1}
                      value={form.solveAmount}
                      onChange={(e) => setForm({ ...form, solveAmount: parseInt(e.target.value) || 1 })}
                      className="w-full text-sm px-3 py-2 border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text"
                    />
                    <select
                      value={form.solveUnit}
                      onChange={(e) => setForm({ ...form, solveUnit: e.target.value as "minutes" | "hours" })}
                      className="text-sm px-2 py-2 border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text"
                    >
                      <option value="minutes">min</option>
                      <option value="hours">hr</option>
                    </select>
                  </div>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-helplus-text">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                Active
              </label>

              {formError && <p className="text-sm text-helplus-danger">{formError}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-helplus-border">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm font-medium text-helplus-text">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !form.name.trim()}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-helplus-primary text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : editing ? "Save" : "Add rule"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDeleteId(null)} />
          <div className="relative w-full max-w-sm mx-4 bg-helplus-surface rounded-xl shadow-xl p-5">
            <h3 className="font-semibold text-helplus-text text-lg mb-2">Delete SLA rule</h3>
            <p className="text-sm text-helplus-text-light mb-4">This can&apos;t be undone.</p>
            {deleteError && <p className="text-sm text-helplus-danger mb-2">{deleteError}</p>}
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm font-medium text-helplus-text">
                Cancel
              </button>
              <button
                onClick={() => remove(deleteId)}
                className="px-4 py-2 text-sm font-medium bg-helplus-danger text-white rounded-lg"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
