// browser-safe helpers for screenshots, no prisma/sharp/node imports here
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MAX_FILES = 5;
export const MAX_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const FILE_LIMITS_HINT = "Up to 5 images, 10 MB each. PNG, JPEG or WebP.";

function clamp(v: number, max: number): number {
  return Math.max(0, Math.min(v, max));
}

export function toImageBox(
  rect: Box,
  shown: { width: number; height: number },
  natural: { width: number; height: number }
): Box {
  const sx = natural.width / shown.width;
  const sy = natural.height / shown.height;
  const x0 = clamp(Math.min(rect.x, rect.x + rect.w) * sx, natural.width);
  const y0 = clamp(Math.min(rect.y, rect.y + rect.h) * sy, natural.height);
  const x1 = clamp(Math.max(rect.x, rect.x + rect.w) * sx, natural.width);
  const y1 = clamp(Math.max(rect.y, rect.y + rect.h) * sy, natural.height);
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

// mirrors the server's own checks, so the user sees the problem before a request is even sent
export function checkFiles(files: File[]): { ok: boolean; error?: string } {
  if (files.length > MAX_FILES) return { ok: false, error: `At most ${MAX_FILES} images at a time` };
  for (const f of files) {
    if (!ALLOWED_TYPES.includes(f.type)) return { ok: false, error: `${f.name} isn't a PNG, JPEG or WebP image` };
    if (f.size > MAX_BYTES) return { ok: false, error: `${f.name} is over 10 MB` };
  }
  return { ok: true };
}

export async function uploadScreenshots(
  ticketId: string,
  files: File[]
): Promise<{ ok: true } | { ok: false; error: string; saved: number }> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  try {
    const res = await fetch(`/api/tickets/${ticketId}/attachments`, { method: "POST", body: form });
    if (res.ok) return { ok: true };
    const d = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: typeof d.error === "string" ? d.error : "Couldn't upload",
      saved: typeof d.saved === "number" ? d.saved : 0,
    };
  } catch {
    return { ok: false, error: "Couldn't upload", saved: 0 };
  }
}
