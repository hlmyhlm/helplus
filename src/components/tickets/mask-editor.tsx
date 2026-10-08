"use client";

import { useRef, useState } from "react";
import { toImageBox, type Box } from "@/lib/attachments/client";

interface DrawnBox {
  screen: Box;
  image: Box;
}

const ORIGINAL_GONE_MESSAGE = "The original was deleted, this image can't be checked any more";

export function MaskEditor({
  attachmentId,
  onCancel,
  onSaved,
  onStale,
}: {
  attachmentId: string;
  onCancel: () => void;
  onSaved: () => void;
  onStale?: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerId = useRef<number | null>(null);
  const [boxes, setBoxes] = useState<DrawnBox[]>([]);
  const [drawing, setDrawing] = useState<Box | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [imageGone, setImageGone] = useState(false);

  // measure against the image, not the overlay
  const localPoint = (e: React.PointerEvent) => {
    const rect = imgRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointerId.current = e.pointerId;
    const p = localPoint(e);
    startRef.current = p;
    setDrawing({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== activePointerId.current || !startRef.current) return;
    const p = localPoint(e);
    setDrawing({ x: startRef.current.x, y: startRef.current.y, w: p.x - startRef.current.x, h: p.y - startRef.current.y });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerId !== activePointerId.current) return;
    const img = imgRef.current;
    // a tiny drag is a missed tap, not a box
    if (drawing && Math.abs(drawing.w) > 3 && Math.abs(drawing.h) > 3 && img && img.naturalWidth > 0) {
      const rect = img.getBoundingClientRect();
      const image = toImageBox(drawing, { width: rect.width, height: rect.height }, { width: img.naturalWidth, height: img.naturalHeight });
      if (image.w > 0 && image.h > 0) setBoxes((b) => [...b, { screen: drawing, image }]);
    }
    setDrawing(null);
    startRef.current = null;
    activePointerId.current = null;
  };

  const undo = () => setBoxes((b) => b.slice(0, -1));

  const save = async () => {
    if (!boxes.length || saving) return;
    const payload = boxes.map((b) => b.image).filter((b) => b.w > 0 && b.h > 0);
    if (!payload.length) {
      setError("Couldn't save, draw a bigger area");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/attachments/${attachmentId}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mask", boxes: payload }),
      });
      if (!res.ok) {
        if (res.status === 410) setError(ORIGINAL_GONE_MESSAGE);
        else setError((await res.json().catch(() => ({}))).error ?? "Couldn't save");
        if (res.status === 409) onStale?.();
        return;
      }
      onSaved();
    } catch {
      setError("Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const allBoxes = [...boxes.map((b) => b.screen), ...(drawing ? [drawing] : [])];

  if (imageGone) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-helplus-danger">{ORIGINAL_GONE_MESSAGE}</p>
        <div className="flex justify-end">
          <button onClick={onCancel} className="h-9 px-3 rounded-md border border-helplus-border text-sm text-helplus-text">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-helplus-text-light">Viewing the original is logged</p>
      <div
        className="relative select-none"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={`/api/attachments/${attachmentId}/original`}
          alt="Original screenshot"
          className="w-full h-auto block rounded-md border border-helplus-border"
          style={{ pointerEvents: "none" }}
          draggable={false}
          onError={() => setImageGone(true)}
        />
        {allBoxes.map((b, i) => (
          <div
            key={i}
            className="absolute bg-black/70"
            style={{
              left: Math.min(b.x, b.x + b.w),
              top: Math.min(b.y, b.y + b.h),
              width: Math.abs(b.w),
              height: Math.abs(b.h),
              pointerEvents: "none",
            }}
          />
        ))}
      </div>
      <p className="text-xs text-helplus-text-light">Drag over any IC number or other text to cover it.</p>
      {error && <p className="text-sm text-helplus-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button
          onClick={undo}
          disabled={!boxes.length}
          className="h-9 px-3 rounded-md border border-helplus-border text-sm text-helplus-text disabled:opacity-60"
        >
          Undo last
        </button>
        <button onClick={onCancel} className="h-9 px-3 rounded-md border border-helplus-border text-sm text-helplus-text">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={!boxes.length || saving}
          className="h-9 px-3 rounded-md bg-helplus-primary text-white text-sm font-medium disabled:opacity-60"
        >
          Save
        </button>
      </div>
    </div>
  );
}
