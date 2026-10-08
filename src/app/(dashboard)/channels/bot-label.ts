export type Tone = "success" | "danger" | "warning" | "muted";

export function botLabel(s: { status: string; stale: boolean; phone: string; error: string }): { text: string; tone: Tone } {
  if (s.status === "connected") return s.stale ? { text: "Worker not running", tone: "danger" } : { text: `Connected as +${s.phone}`, tone: "success" };
  if (s.status === "qr") return { text: "Scan the QR code", tone: "warning" };
  if (s.status === "starting") return { text: "Starting…", tone: "muted" };
  if (s.status === "stopping") return { text: "Stopping…", tone: "muted" };
  if (s.status === "disconnected") return { text: s.error ? `Disconnected. ${s.error}` : "Disconnected", tone: "danger" };
  return { text: s.error ? `Not connected. ${s.error}` : "Not connected", tone: "muted" };
}
