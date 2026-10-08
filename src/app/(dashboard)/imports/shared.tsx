import { cn } from "@/lib/utils";

export type ImportStatus = "uploaded" | "queued" | "running" | "done" | "failed";

export interface ImportJob {
  id: string;
  projectId: string;
  kind: "whatsapp" | "csv";
  status: ImportStatus;
  fileName: string;
  options: { order?: "dmy" | "mdy"; staff?: string[]; mapping?: Record<string, string> };
  stats: Record<string, number>;
  progress: { next?: number; errors?: string[] };
  error: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export const KIND_LABELS: Record<string, string> = { whatsapp: "WhatsApp chat", csv: "Old system (CSV)" };

const STATUS_LABELS: Record<ImportStatus, string> = {
  uploaded: "Waiting to start",
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
};

const DOT: Record<ImportStatus, string> = {
  uploaded: "bg-helplus-border",
  queued: "bg-helplus-primary",
  running: "bg-helplus-primary",
  done: "bg-helplus-success",
  failed: "bg-helplus-danger",
};

export function StatusDot({ status }: { status: ImportStatus }) {
  return (
    <span
      title={STATUS_LABELS[status]}
      aria-label={STATUS_LABELS[status]}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", DOT[status] ?? "bg-helplus-border")}
    />
  );
}

export function statusLabel(status: ImportStatus): string {
  return STATUS_LABELS[status] ?? status;
}

// routes send a string, the auth wrapper sends { code, message }
export function errorText(json: unknown, fallback: string): string {
  const e = (json as { error?: unknown } | null)?.error;
  if (typeof e === "string" && e) return e;
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" && m ? m : fallback;
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function OrderPicker({ value, onChange, disabled }: { value: "dmy" | "mdy"; onChange: (v: "dmy" | "mdy") => void; disabled?: boolean }) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="text-xs font-medium text-helplus-text-light mb-1">Date order</legend>
      {[
        { v: "dmy" as const, label: "Day/Month (12/10 = 12 October)" },
        { v: "mdy" as const, label: "Month/Day" },
      ].map((o) => (
        <label key={o.v} className="flex items-center gap-2 text-sm text-helplus-text">
          <input type="radio" name="date-order" checked={value === o.v} onChange={() => onChange(o.v)} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}
