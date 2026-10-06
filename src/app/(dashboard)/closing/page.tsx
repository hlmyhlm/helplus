"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { clearCompanyCache } from "@/lib/hooks/use-company";
import { closingOptions } from "@/lib/sla/closing-options";

export default function ClosingPage() {
  const [days, setDays] = useState(3);
  const [stored, setStored] = useState(3);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setDays(d.autoCloseDays ?? 3);
        setStored(d.autoCloseDays ?? 3);
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
        body: JSON.stringify({ autoCloseDays: days }),
      });
      if (!res.ok) {
        setSaveError((await res.json().catch(() => ({}))).error ?? "Couldn't save");
        return;
      }
      // the ticket page reads the days from the company cache
      clearCompanyCache();
      setSaved(true);
    } catch {
      setSaveError("Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Header title="Closing tickets" />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-xl bg-helplus-surface border border-helplus-border rounded-xl p-5 space-y-4">
          {loadError && <p className="text-sm text-helplus-danger">{loadError}</p>}

          <div>
            <label className="block text-sm font-semibold text-helplus-text mb-2">
              Close answered tickets automatically
            </label>
            <select
              value={days}
              onChange={(e) => {
                setDays(parseInt(e.target.value));
                setSaved(false);
              }}
              className="w-full text-sm px-3 py-2 border border-helplus-border rounded-lg bg-helplus-bg text-helplus-text"
            >
              {closingOptions(stored).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <p className="text-xs text-helplus-text-light">
            Clients with an email get a warning a day before. Tickets close only if the client hasn&apos;t replied.
            A reply sends the ticket back to staff.
          </p>

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
