"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Header } from "@/components/layout/header";
import { unwrapList } from "@/lib/api-client";
import { useCompany } from "@/lib/hooks/use-company";

interface Project {
  id: string;
  name: string;
  isDefault: boolean;
  archived: boolean;
  openTickets: number;
}
interface Person {
  id: string;
  name: string;
  role: string;
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { projectLabel, canManageProjects } = useCompany();
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [staff, setStaff] = useState<Person[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [accessError, setAccessError] = useState("");
  const [accessLoaded, setAccessLoaded] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState("");

  useEffect(() => {
    fetch("/api/projects?archived=1")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const found = unwrapList<Project>(d).find((p) => p.id === id) ?? null;
        if (!found) setMissing(true);
        setProject(found);
      })
      .catch(() => setLoadError("Couldn't load this project."));
  }, [id]);

  // access panel is admin-only server side too, so only ask for it when we can manage.
  // both calls must succeed before Save is allowed, or it would save an empty list over real grants
  useEffect(() => {
    if (!canManageProjects) return;
    let cancelled = false;
    setAccessLoaded(false);
    setAccessError("");
    (async () => {
      try {
        const accessRes = await fetch(`/api/projects/${id}/access`);
        if (!accessRes.ok) throw new Error("access");
        const accessData = await accessRes.json();
        const usersRes = await fetch("/api/admin/users?limit=100");
        if (!usersRes.ok) throw new Error("users");
        const usersData = await usersRes.json();
        if (cancelled) return;
        setSelected(accessData.adminIds ?? []);
        setStaff(unwrapList<Person>(usersData).filter((p) => p.role === "staff" || p.role === "viewer"));
        setAccessLoaded(true);
      } catch {
        if (!cancelled) setAccessError("Couldn't load staff access.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, canManageProjects]);

  const toggle = (adminId: string) => {
    setSaved("");
    setSelected((cur) => (cur.includes(adminId) ? cur.filter((x) => x !== adminId) : [...cur, adminId]));
  };

  const save = async () => {
    setSaveError("");
    setSaved("");
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${id}/access`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminIds: selected }),
      });
      if (res.ok) setSaved("Saved");
      else setSaveError("Couldn't save");
    } catch {
      setSaveError("Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    setArchiveError("");
    setArchiving(true);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !project?.archived }),
      });
      if (!res.ok) {
        setArchiveError((await res.json().catch(() => ({}))).error ?? "Couldn't archive");
        return;
      }
      setProject((p) => (p ? { ...p, archived: !p.archived } : p));
    } catch {
      setArchiveError("Couldn't archive");
    } finally {
      setArchiving(false);
    }
  };

  const singular = projectLabel === "Projects" ? "project" : "client";

  const Back = (
    <Link
      href="/projects"
      className="inline-flex items-center gap-1 h-9 px-3 rounded-md border border-helplus-border text-sm text-helplus-text"
    >
      <ChevronLeft className="h-4 w-4" /> Back
    </Link>
  );

  if (missing) {
    return (
      <>
        <Header title="Not found" actions={Back} />
        <div className="p-6 text-sm text-helplus-text-light">This {singular} doesn&apos;t exist.</div>
      </>
    );
  }

  if (loadError && !project) {
    return (
      <>
        <Header title="Error" actions={Back} />
        <div className="p-6 text-sm text-helplus-danger">{loadError}</div>
      </>
    );
  }

  if (!project) return <div className="p-6 text-sm text-helplus-text-light">Loading…</div>;

  return (
    <>
      <Header
        title={project.name}
        description={`${project.openTickets} open tickets${project.archived ? " · archived" : ""}`}
        actions={Back}
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 max-w-2xl">
        <Link href={`/tickets?projectId=${project.id}`} className="text-sm text-helplus-link">
          See this {singular}&apos;s tickets
        </Link>
        {canManageProjects && (
          <div className="rounded-md border border-helplus-border bg-helplus-surface p-4 space-y-3">
            <h3 className="text-sm font-semibold text-helplus-text">Staff who can see it</h3>
            <p className="text-xs text-helplus-text-light">Owners, admins and supervisors always see every {singular}.</p>
            {accessError && <p className="text-sm text-helplus-danger">{accessError}</p>}
            {staff.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm text-helplus-text min-h-[36px]">
                <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                {p.name} <span className="text-xs text-helplus-text-light">{p.role}</span>
              </label>
            ))}
            {accessLoaded && !staff.length && <p className="text-sm text-helplus-text-light">No staff or viewer accounts yet.</p>}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={save}
                disabled={saving || !accessLoaded}
                className="h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium disabled:opacity-60"
              >
                Save access
              </button>
              {saved && <span className="text-xs text-helplus-text-light">{saved}</span>}
              {saveError && <span className="text-xs text-helplus-danger">{saveError}</span>}
            </div>
            {!project.isDefault && (
              <div className="flex items-center gap-3">
                <button
                  onClick={archive}
                  disabled={archiving}
                  className="h-9 px-3 rounded-md border border-helplus-border text-sm text-helplus-text disabled:opacity-60"
                >
                  {project.archived ? "Unarchive" : "Archive"}
                </button>
                {archiveError && <span className="text-xs text-helplus-danger">{archiveError}</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
