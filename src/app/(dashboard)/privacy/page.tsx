"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";

const DAYS = [30, 60, 90, 180, 365];

// keeps a stored value that isn't in the list, like 45 set through the api
function retentionOptions(current: number): number[] {
  const values = [...DAYS];
  if (!values.includes(current)) values.push(current);
  return values.sort((a, b) => a - b);
}

export default function PrivacyPage() {
  const [days, setDays] = useState(90);
  const [stored, setStored] = useState(90);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setDays(d.originalRetentionDays ?? 90);
        setStored(d.originalRetentionDays ?? 90);
      })
      .catch(() => setLoadError("Couldn't load settings."));
  }, []);

  const save = async () => {
    setSaveError("");
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originalRetentionDays: days }),
      });
      if (!res.ok) {
        setSaveError((await res.json().catch(() => ({}))).error ?? "Couldn't save");
        return;
      }
      setStored(days);
      setSaved(true);
    } catch {
      setSaveError("Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header title="Privacy & IC" />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-xl bg-helplus-surface border border-helplus-border rounded-xl p-5 space-y-4">
          {loadError && <p className="text-sm text-helplus-danger">{loadError}</p>}

          <p className="text-sm text-helplus-text-light">
            IC numbers are hidden in messages and covered in screenshots. Originals are encrypted and only staff can
            open them. Every view is logged.
          </p>

          <div>
            <label className="block text-sm font-semibold text-helplus-text mb-2">
              Delete original screenshots
            </label>
            <select
              value={days}
              onChange={(e) => {
                setDays(parseInt(e.target.value));
                setSaved(false);
              }}
              className="w-full text-sm px-3 py-2 border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text"
            >
              {retentionOptions(stored).map((d) => (
                <option key={d} value={d}>{d} days after the ticket closes</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="h-9 px-4 rounded-md bg-helplus-primary text-white text-sm font-medium disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span className="text-sm text-helplus-success">Saved</span>}
            {saveError && <span className="text-sm text-helplus-danger">{saveError}</span>}
          </div>
        </div>
      </div>
    </>
  );
}
