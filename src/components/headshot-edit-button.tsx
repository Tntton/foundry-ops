'use client';

import { useState, useTransition } from 'react';
import { setHeadshotFromCrop } from '@/app/(app)/me/actions';
import { HeadshotCropper, type HeadshotResult } from '@/components/headshot-cropper';
import { Button } from '@/components/ui/button';

/**
 * Drop-in replacement for the plain "Upload headshot" button. Click
 * opens an inline cropper panel with circular preview + zoom slider;
 * confirm pipes the cropped data URL through `setHeadshotFromCrop`.
 *
 * Reusable by both:
 *   - the staff member's own /me page (no targetPersonId)
 *   - admin "set someone else's headshot" surface (targetPersonId set)
 *
 * The action authorises both paths server-side; this component just
 * hands off the resulting JPEG.
 */
export function HeadshotEditButton({
  currentUrl,
  targetPersonId,
  label = 'Edit headshot',
  size = 'md',
}: {
  currentUrl: string | null;
  /** Omit / pass null to edit the signed-in user's own headshot. */
  targetPersonId?: string | null;
  label?: string;
  /** Visual size of the inline preview chip. */
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | { kind: 'idle' }
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const previewSize = size === 'sm' ? 'h-12 w-12' : 'h-20 w-20';

  function onConfirm(crop: HeadshotResult) {
    return new Promise<void>((resolve) => {
      const fd = new FormData();
      if (targetPersonId) fd.set('targetPersonId', targetPersonId);
      fd.set('dataUrl', crop.dataUrl);
      startTransition(async () => {
        const r = await setHeadshotFromCrop({ status: 'idle' }, fd);
        if (r.status === 'success') {
          setResult({ kind: 'success', message: r.message });
          setOpen(false);
        } else if (r.status === 'error') {
          setResult({ kind: 'error', message: r.message });
        }
        resolve();
      });
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt="Headshot"
            className={`${previewSize} shrink-0 rounded-full border border-line object-cover`}
          />
        ) : (
          <div
            className={`${previewSize} flex shrink-0 items-center justify-center rounded-full border border-dashed border-line bg-surface-subtle text-[10px] text-ink-3`}
          >
            No image
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setResult({ kind: 'idle' });
              setOpen((o) => !o);
            }}
          >
            {open ? 'Close' : currentUrl ? label : 'Upload headshot'}
          </Button>
          {result.kind === 'success' && (
            <span className="text-[11px] text-status-green">{result.message}</span>
          )}
          {result.kind === 'error' && (
            <span className="text-[11px] text-status-red">{result.message}</span>
          )}
        </div>
      </div>

      {open && (
        <div className="rounded-lg border border-line bg-surface-elev p-4">
          <HeadshotCropper
            onConfirm={onConfirm}
            onCancel={() => setOpen(false)}
            busy={pending}
            initialDataUrl={
              currentUrl && currentUrl.startsWith('data:') ? currentUrl : null
            }
          />
        </div>
      )}
    </div>
  );
}
