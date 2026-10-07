"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import type { AttachmentRow } from "@/lib/attachments/row";
import { ALLOWED_TYPES, FILE_LIMITS_HINT, checkFiles, uploadScreenshots } from "@/lib/attachments/client";
import { MaskEditor } from "./mask-editor";

const ACCEPT = ALLOWED_TYPES.join(",");
const ORIGINAL_GONE_MESSAGE = "The original was deleted, this image can't be checked any more";
const ORIGINAL_LOAD_MESSAGE = "Couldn't load the original. It may have been deleted.";
const POLL_FAST_MS = 3000;
const POLL_SLOW_MS = 30000;
const POLL_FAST_LIMIT = 20;

function statusColor(status: string): string {
  if (status === "clean") return "#12B76A";
  if (status === "masked") return "#3B3FA6";
  if (status === "needs_check") return "#F79009";
  return "#98A2B3"; // pending
}

function statusText(a: AttachmentRow): string {
  let t = "Checking for IC…";
  if (a.status === "clean") t = "No IC found";
  else if (a.status === "masked") t = `IC covered (${a.icCount})`;
  else if (a.status === "needs_check") t = "Needs check";
  if (a.originalDeletedAt) t += " · original deleted";
  return t;
}

// clean/masked show the shared masked image, everything else is a placeholder tile
function hasMaskedImage(a: AttachmentRow): boolean {
  return a.status === "clean" || a.status === "masked";
}

function openable(a: AttachmentRow, canCheck: boolean): boolean {
  if (hasMaskedImage(a)) return true;
  if (a.status === "needs_check") return canCheck;
  return false;
}

export function Screenshots({
  ticketId,
  attachments,
  canCheck,
  canUpload,
  onChanged,
}: {
  ticketId: string;
  attachments: AttachmentRow[];
  canCheck: boolean;
  canUpload: boolean;
  onChanged: () => void;
}) {
  const [viewingId, setViewingId] = useState<string | null>(null);
  // the latest row after a poll, not the copy from when it was opened
  const viewing = attachments.find((a) => a.id === viewingId) ?? null;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollCountRef = useRef(0);

  const doUpload = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const check = checkFiles(files);
      if (!check.ok) {
        setUploadError(check.error!);
        return;
      }
      setUploadError("");
      setUploading(true);
      const res = await uploadScreenshots(ticketId, files);
      setUploading(false);
      if (!res.ok) {
        setUploadError(res.saved > 0 ? `${res.saved} of ${files.length} saved. ${res.error}` : res.error);
        onChanged();
        return;
      }
      onChanged();
    },
    [ticketId, onChanged]
  );

  useEffect(() => {
    if (!canUpload) return;
    const handler = (e: ClipboardEvent) => {
      if (uploading) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (typing && e.clipboardData?.types.includes("text/plain")) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      doUpload(files);
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [canUpload, uploading, doUpload]);

  const pendingIds = attachments
    .filter((a) => a.status === "pending")
    .map((a) => a.id)
    .join(",");
  useEffect(() => {
    if (!pendingIds) return;
    pollCountRef.current = 0;
    let id: ReturnType<typeof setInterval>;
    const tick = () => {
      pollCountRef.current += 1;
      onChanged();
      if (pollCountRef.current === POLL_FAST_LIMIT) {
        clearInterval(id);
        id = setInterval(tick, POLL_SLOW_MS);
      }
    };
    id = setInterval(tick, POLL_FAST_MS);
    return () => clearInterval(id);
  }, [pendingIds, onChanged]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {attachments.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => openable(a, canCheck) && setViewingId(a.id)}
            className="flex flex-col items-center gap-1 w-24 text-left"
          >
            {hasMaskedImage(a) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/attachments/${a.id}?v=${a.status}-${a.icCount}`}
                alt={a.fileName}
                className="h-24 w-24 object-cover rounded-md border border-helplus-border"
              />
            ) : (
              <div className="h-24 w-24 rounded-md border border-helplus-border bg-helplus-bg grid place-items-center text-center px-1">
                <span className="text-[10px] text-helplus-text-light leading-tight">
                  {a.status === "pending"
                    ? "Checking for IC…"
                    : canCheck
                      ? "Needs check · open to review"
                      : "Waiting for staff to check"}
                </span>
              </div>
            )}
            <span className="flex items-center gap-1 text-[11px] text-helplus-text-light">
              <span className="h-[6px] w-[6px] rounded-full shrink-0" style={{ background: statusColor(a.status) }} />
              <span className="truncate max-w-[88px]">{statusText(a)}</span>
            </span>
          </button>
        ))}
        {canUpload && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 h-8 px-3 self-start rounded-md border border-helplus-border text-xs text-helplus-text disabled:opacity-60"
          >
            <ImagePlus className="h-3.5 w-3.5" /> Add screenshot
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            doUpload(files);
          }}
        />
      </div>
      {canUpload && <p className="text-xs text-helplus-text-light">{FILE_LIMITS_HINT}</p>}
      {uploadError && <p className="text-sm text-helplus-danger">{uploadError}</p>}
      {viewing && (
        <Viewer attachment={viewing} canCheck={canCheck} onClose={() => setViewingId(null)} onChanged={onChanged} />
      )}
    </div>
  );
}

function Viewer({
  attachment,
  canCheck,
  onClose,
  onChanged,
}: {
  attachment: AttachmentRow;
  canCheck: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const originalGone = !!attachment.originalDeletedAt;
  const [showingOriginal, setShowingOriginal] = useState(attachment.status === "needs_check" && !originalGone);
  const [editingMask, setEditingMask] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    attachment.status === "needs_check" && originalGone ? ORIGINAL_GONE_MESSAGE : ""
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editingMask) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, editingMask]);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/attachments/${attachment.id}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      });
      if (!res.ok) {
        if (res.status === 410) setError(ORIGINAL_GONE_MESSAGE);
        else setError((await res.json().catch(() => ({}))).error ?? "Couldn't check");
        if (res.status === 409) onChanged();
        return;
      }
      onChanged();
      onClose();
    } catch {
      setError("Couldn't check");
    } finally {
      setBusy(false);
    }
  };

  const src = showingOriginal ? `/api/attachments/${attachment.id}/original` : `/api/attachments/${attachment.id}`;
  const noImageToShow = attachment.status === "needs_check" && originalGone;

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full md:max-w-xl rounded-t-xl md:rounded-lg bg-helplus-surface border border-helplus-border p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-helplus-text break-words pr-2">{attachment.fileName}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1 text-helplus-text-light shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>
        {editingMask ? (
          <MaskEditor
            attachmentId={attachment.id}
            onCancel={() => setEditingMask(false)}
            onStale={onChanged}
            onSaved={() => {
              setEditingMask(false);
              onChanged();
              onClose();
            }}
          />
        ) : (
          <>
            {!noImageToShow && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={attachment.fileName}
                className="w-full h-auto rounded-md border border-helplus-border"
                onError={() => {
                  if (showingOriginal) setError(ORIGINAL_LOAD_MESSAGE);
                }}
              />
            )}
            {showingOriginal && !noImageToShow && (
              <p className="text-xs text-helplus-text-light">Viewing the original is logged</p>
            )}
            {error && <p className="text-sm text-helplus-danger">{error}</p>}
            {canCheck && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {!showingOriginal && !originalGone && (
                    <button
                      onClick={() => setShowingOriginal(true)}
                      disabled={busy}
                      className="h-9 px-3 rounded-md border border-helplus-border text-sm text-helplus-text disabled:opacity-60"
                    >
                      Show original
                    </button>
                  )}
                  {!originalGone && (
                    <button
                      onClick={() => setEditingMask(true)}
                      disabled={busy}
                      className="h-9 px-3 rounded-md border border-helplus-border text-sm text-helplus-text disabled:opacity-60"
                    >
                      Cover an area
                    </button>
                  )}
                  {attachment.status === "needs_check" && !originalGone && (
                    <button
                      onClick={confirm}
                      disabled={busy}
                      className="h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium disabled:opacity-60"
                    >
                      No IC visible, mark checked
                    </button>
                  )}
                </div>
                {attachment.status === "needs_check" && !originalGone && (
                  <p className="text-xs text-helplus-warning">This makes the image visible as shown. Cover any IC first.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
