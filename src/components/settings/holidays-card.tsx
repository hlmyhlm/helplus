"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";

interface Holiday {
  id: string;
  date: string;
  name: string;
}

export function HolidaysCard() {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const res = await fetch("/api/holidays");
      if (res.ok) setHolidays((await res.json()).data ?? []);
      else setLoadError("Couldn't load holidays.");
    } catch {
      setLoadError("Couldn't load holidays.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    setFormError("");
    if (!date) return;
    setSaving(true);
    try {
      const res = await fetch("/api/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, name: name.trim() || undefined }),
      });
      if (!res.ok) {
        setFormError((await res.json().catch(() => ({}))).error ?? "Couldn't add holiday");
        return;
      }
      setDate("");
      setName("");
      await load();
    } catch {
      setFormError("Couldn't add holiday");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    setFormError("");
    try {
      const res = await fetch(`/api/holidays/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setFormError((await res.json().catch(() => ({}))).error ?? "Couldn't remove holiday");
        return;
      }
      await load();
    } catch {
      setFormError("Couldn't remove holiday");
    }
  };

  return (
    <div className="bg-helplus-surface border border-helplus-border rounded-xl p-5">
      <h3 className="text-sm font-semibold text-helplus-text">Holidays</h3>
      <p className="text-xs text-helplus-text-light mt-0.5">
        Days off on top of the weekly hours. They only count while business hours are on.
      </p>

      {loadError && <p className="text-sm text-helplus-danger mt-3">{loadError}</p>}

      <div className="mt-4 space-y-2">
        {holidays.map((h) => (
          <div
            key={h.id}
            className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-helplus-border bg-helplus-bg"
          >
            <span className="text-sm text-helplus-text">
              {h.date} {h.name && <span className="text-helplus-text-light">· {h.name}</span>}
            </span>
            <button
              onClick={() => remove(h.id)}
              aria-label="Remove holiday"
              className="p-1.5 hover:bg-helplus-primary-50 rounded-lg transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5 text-helplus-text-light" />
            </button>
          </div>
        ))}
        {!holidays.length && !loadError && (
          <p className="text-sm text-helplus-text-light">No holidays yet.</p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="mt-4 flex flex-wrap items-end gap-2"
      >
        <div>
          <label className="block text-xs text-helplus-text-light mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 rounded-md border border-helplus-border bg-helplus-surface px-2 text-sm text-helplus-text"
          />
        </div>
        <div>
          <label className="block text-xs text-helplus-text-light mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Optional"
            className="h-9 rounded-md border border-helplus-border bg-helplus-surface px-3 text-sm text-helplus-text w-40"
          />
        </div>
        <button
          type="submit"
          disabled={saving || !date}
          className="h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium disabled:opacity-60"
        >
          Add
        </button>
      </form>
      {formError && <p className="text-sm text-helplus-danger mt-2">{formError}</p>}
    </div>
  );
}
