'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * LinkedIn-style circular headshot picker.
 *
 *   1. User picks a file → image renders inside a fixed square viewport.
 *   2. A circular mask + crosshair overlay show the final crop region.
 *   3. User drags the image to position, slides to zoom in/out.
 *   4. Confirm → we render the cropped square to a canvas at OUTPUT_PX
 *      and emit a JPEG/PNG data URL the parent can upload.
 *
 * No external dependencies — plain React + canvas. The parent decides
 * what to do with the result (upload via FormData, etc.). Designed to
 * be reusable across both the /me self-edit and the admin "upload for
 * anyone" flow.
 */

const VIEWPORT_PX = 280; // square stage where the user composes
const OUTPUT_PX = 512;   // exported headshot resolution
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

export type HeadshotResult = {
  dataUrl: string;
  mime: string;
};

export function HeadshotCropper({
  onConfirm,
  onCancel,
  busy = false,
  initialDataUrl = null,
}: {
  onConfirm: (result: HeadshotResult) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
  initialDataUrl?: string | null;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(initialDataUrl);
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  // Position is the top-left offset (in viewport px) of the displayed
  // image relative to the viewport. Zoom scales the image's natural
  // dimensions. Together they map cleanly to the canvas math at confirm.
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pickFile() {
    fileInputRef.current?.click();
  }

  function readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  async function onFile(file: File) {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Pick an image file (JPEG/PNG/WebP).');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError('Max 12 MB.');
      return;
    }
    try {
      const dataUrl = await readFile(file);
      setImgSrc(dataUrl);
      // Reset transform; the load handler below sets the initial zoom
      // so the image fills the viewport's shorter axis.
      setPos({ x: 0, y: 0 });
      setZoom(1);
    } catch {
      setError('Could not read image.');
    }
  }

  // When the image lands, compute a "fit-to-viewport" zoom so the
  // shorter axis matches VIEWPORT_PX. Position is centered.
  function handleImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const el = e.currentTarget;
    imgRef.current = el;
    const natural = { w: el.naturalWidth, h: el.naturalHeight };
    setImgNatural(natural);
    const fit = Math.max(
      VIEWPORT_PX / natural.w,
      VIEWPORT_PX / natural.h,
    );
    setZoom(fit);
    setPos({
      x: (VIEWPORT_PX - natural.w * fit) / 2,
      y: (VIEWPORT_PX - natural.h * fit) / 2,
    });
  }

  // Drag handling. Pointer events cover mouse + touch; we capture so
  // releases outside the viewport still register.
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!imgSrc) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    });
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    setPos({
      x: drag.origX + (e.clientX - drag.startX),
      y: drag.origY + (e.clientY - drag.startY),
    });
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (drag) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDrag(null);
      // Constrain so the viewport never shows blank space outside the
      // image. (Allow some over-pan during drag for feel; clamp on
      // release.)
      clampPosition();
    }
  }

  function clampPosition() {
    if (!imgNatural) return;
    const scaledW = imgNatural.w * zoom;
    const scaledH = imgNatural.h * zoom;
    setPos((p) => ({
      x: Math.min(0, Math.max(p.x, VIEWPORT_PX - scaledW)),
      y: Math.min(0, Math.max(p.y, VIEWPORT_PX - scaledH)),
    }));
  }

  // Re-clamp whenever zoom changes (zooming out can leave the image
  // smaller than the viewport on one axis; clamping keeps the viewport
  // filled from a sensible corner).
  useEffect(() => {
    clampPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, imgNatural]);

  async function confirm() {
    if (!imgSrc || !imgNatural) return;
    // Render the cropped square to an offscreen canvas. The ratio of
    // OUTPUT_PX:VIEWPORT_PX scales every position/dimension into
    // export-resolution coordinates.
    const scale = OUTPUT_PX / VIEWPORT_PX;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_PX;
    canvas.height = OUTPUT_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setError('Browser canvas unavailable.');
      return;
    }
    // Make sure the image is decoded — it usually is by now since the
    // user has been interacting with it, but a freshly-set source can
    // race the confirm click.
    const img = await loadImage(imgSrc);
    const dW = imgNatural.w * zoom * scale;
    const dH = imgNatural.h * zoom * scale;
    const dX = pos.x * scale;
    const dY = pos.y * scale;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, OUTPUT_PX, OUTPUT_PX);
    ctx.drawImage(img, dX, dY, dW, dH);
    // JPEG @ 0.92 is a good default — much smaller than PNG for
    // photographs, no perceptible quality loss for headshots.
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    await onConfirm({ dataUrl, mime: 'image/jpeg' });
  }

  return (
    <div className="space-y-3">
      {!imgSrc ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-surface-subtle/40 p-8 text-center">
          <p className="text-sm text-ink-2">
            Pick an image to crop into a circular headshot.
          </p>
          <Button type="button" size="sm" onClick={pickFile}>
            Choose image
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col items-center gap-3">
            <div
              className="relative shrink-0 cursor-grab overflow-hidden rounded bg-black select-none"
              style={{ width: VIEWPORT_PX, height: VIEWPORT_PX, touchAction: 'none' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgSrc}
                alt="Crop preview"
                draggable={false}
                onLoad={handleImageLoad}
                style={{
                  position: 'absolute',
                  left: pos.x,
                  top: pos.y,
                  width: imgNatural ? imgNatural.w * zoom : 'auto',
                  height: imgNatural ? imgNatural.h * zoom : 'auto',
                  maxWidth: 'none',
                  pointerEvents: 'none',
                }}
              />
              {/* Circular mask overlay — a square SVG with a hole the
                  size of the viewport, filled outside with semi-opaque
                  black so the user sees the final crop region. */}
              <svg
                width={VIEWPORT_PX}
                height={VIEWPORT_PX}
                className="pointer-events-none absolute inset-0"
              >
                <defs>
                  <mask id="hs-mask">
                    <rect width={VIEWPORT_PX} height={VIEWPORT_PX} fill="white" />
                    <circle
                      cx={VIEWPORT_PX / 2}
                      cy={VIEWPORT_PX / 2}
                      r={VIEWPORT_PX / 2 - 2}
                      fill="black"
                    />
                  </mask>
                </defs>
                <rect
                  width={VIEWPORT_PX}
                  height={VIEWPORT_PX}
                  fill="rgba(0, 0, 0, 0.55)"
                  mask="url(#hs-mask)"
                />
                <circle
                  cx={VIEWPORT_PX / 2}
                  cy={VIEWPORT_PX / 2}
                  r={VIEWPORT_PX / 2 - 2}
                  fill="none"
                  stroke="white"
                  strokeWidth={2}
                />
              </svg>
            </div>

            <div className="flex w-full max-w-sm items-center gap-2 text-xs text-ink-3">
              <span>Zoom</span>
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="flex-1"
              />
              <span className="w-10 text-right tabular-nums">{zoom.toFixed(2)}×</span>
            </div>
            <p className="text-[11px] text-ink-3">
              Drag to position · scroll the slider to zoom · circle is the final crop.
            </p>
          </div>
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />

      {error && <p className="text-xs text-status-red">{error}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {imgSrc && (
          <Button type="button" size="sm" variant="ghost" onClick={pickFile}>
            Choose different image
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void confirm()}
          disabled={!imgSrc || busy}
        >
          {busy ? 'Saving…' : 'Save headshot'}
        </Button>
      </div>
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}
