"use client";

import { useRef, useState } from "react";
import { toImageBox, type Box } from "@/lib/attachments/client";

export function MaskEditor({
  attachmentId,
  onCancel,
  onSaved,
}: {
  attachmentId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [drawing, setDrawing] = useState<Box | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const localPoint = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    startRef.current = p;
    setDrawing({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    const p = localPoint(e);
    setDrawing({ x: startRef.current.x, y: startRef.current.y, w: p.x - startRef.current.x, h: p.y - startRef.current.y });
  };

  const onPointerUp = () => {
    // a tiny drag is a missed tap, not a box
    if (drawing && Math.abs(drawing.w) > 3 && Math.abs(drawing.h) > 3) setBoxes((b) => [...b, drawing]);
    setDrawing(null);
    startRef.current = null;
  };

  const undo = () => setBoxes((b) => b.slice(0, -1));

  const save = async () => {
    if (!boxes.length || saving || !imgRef.current) return;
    setSaving(true);
    setError("");
    const img = imgRef.current;
    const shown = { width: img.clientWidth, height: img.clientHeight };
    const natural = { width: img.naturalWidth, height: img.naturalHeight };
    const payload = boxes.map((b) => toImageBox(b, shown, natural));
    try {
      const res = await fetch(`/api/attachments/${attachmentId}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mask", boxes: payload }),
      });
      if (!res.ok) {
        if (res.status === 410) setError("The original was deleted, this image can't be checked any more");
        else setError((await res.json().catch(() => ({}))).error ?? "Couldn't save");
        return;
      }
      onSaved();
    } catch {
      setError("Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const allBoxes = drawing ? [...boxes, drawing] : boxes;

  return (
    <div className="space-y-3">
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
