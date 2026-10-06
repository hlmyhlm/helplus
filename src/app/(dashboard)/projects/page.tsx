"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { unwrapList } from "@/lib/api-client";
import { useCompany } from "@/lib/hooks/use-company";

interface Project {
  id: string;
  name: string;
  isDefault: boolean;
  archived: boolean;
  openTickets: number;
  people: number;
}

export default function ProjectsPage() {
  const { projectLabel, canManageProjects } = useCompany();
  const [projects, setProjects] = useState<Project[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState("");
  const [loadError, setLoadError] = useState("");
  const [createError, setCreateError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch(`/api/projects${showArchived ? "?archived=1" : ""}`);
      if (res.ok) setProjects(unwrapList<Project>(await res.json()));
      else setLoadError("Couldn't load the list.");
    } catch {
      setLoadError("Couldn't load the list.");
    }
  }, [showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setCreateError("");
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setCreateError((await res.json().catch(() => ({}))).error ?? "Couldn't create");
        return;
      }
      setName("");
      await load();
    } catch {
      setCreateError("Couldn't create");
    } finally {
      setSaving(false);
    }
  };

  const singular = projectLabel === "Projects" ? "project" : "client";

  return (
    <>
      <Header title={projectLabel} description={`Tickets and people are grouped by ${singular}`} />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        {canManageProjects && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
            className="flex flex-wrap gap-2"
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`New ${singular} name`}
              className="flex-1 min-w-[200px] max-w-sm h-9 rounded-md border border-helplus-border bg-helplus-surface px-3 text-sm text-helplus-text"
            />
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium disabled:opacity-60"
            >
              Add {singular}
            </button>
            {createError && <p className="w-full text-sm text-helplus-danger">{createError}</p>}
          </form>
        )}
        <label className="flex items-center gap-2 text-sm text-helplus-text">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        {loadError && <p className="text-sm text-helplus-danger">{loadError}</p>}
        <div className="rounded-md border border-helplus-border bg-helplus-surface divide-y divide-helplus-border">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-helplus-primary-50"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-helplus-text truncate">
                  {p.name} {p.isDefault && <span className="text-xs text-helplus-text-light">(default)</span>}{" "}
                  {p.archived && <span className="text-xs text-helplus-text-light">(archived)</span>}
                </div>
                <div className="text-xs text-helplus-text-light">{p.people} people</div>
              </div>
              <div className="text-sm text-helplus-text shrink-0">
                <span className="font-mono">{p.openTickets}</span> <span className="text-xs text-helplus-text-light">open</span>
              </div>
            </Link>
          ))}
          {!projects.length && !loadError && (
            <div className="p-4 text-sm text-helplus-text-light">No {projectLabel.toLowerCase()} yet.</div>
          )}
        </div>
      </div>
    </>
  );
}
