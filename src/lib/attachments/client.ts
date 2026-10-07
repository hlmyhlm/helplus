// browser-safe helpers for screenshots, no prisma/sharp/node imports here
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function toImageBox(
  rect: Box,
  shown: { width: number; height: number },
  natural: { width: number; height: number }
): Box {
  const sx = natural.width / shown.width;
  const sy = natural.height / shown.height;
  const x0 = Math.max(0, Math.min(rect.x, rect.x + rect.w) * sx);
  const y0 = Math.max(0, Math.min(rect.y, rect.y + rect.h) * sy);
  const x1 = Math.min(natural.width, Math.max(rect.x, rect.x + rect.w) * sx);
  const y1 = Math.min(natural.height, Math.max(rect.y, rect.y + rect.h) * sy);
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

export async function uploadScreenshots(ticketId: string, files: File[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  try {
    const res = await fetch(`/api/tickets/${ticketId}/attachments`, { method: "POST", body: form });
    if (res.ok) return { ok: true };
    const d = await res.json().catch(() => ({}));
    return { ok: false, error: typeof d.error === "string" ? d.error : "Couldn't upload" };
  } catch {
    return { ok: false, error: "Couldn't upload" };
  }
}
