'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * Banner rendered above a form that's been hydrated from an assistant
 * prefill token. Tells the user what was prefilled, gives an undo
 * (navigates to the same URL without the prefill param), and lets them
 * dismiss the banner without losing the prefilled values.
 *
 * Phase 3 design rule: the user is still the actor. This banner is
 * the visual reminder that the assistant only suggested — they're
 * about to submit.
 */
export function PrefillBanner({
  summary,
  cleanUrl,
  ignored,
}: {
  summary: string;
  /** URL to navigate to when the user clicks "Undo" — the same page
   *  without the prefill query param. The form returns to its
   *  unhydrated baseline. */
  cleanUrl: string;
  /** Optional list of entries that couldn't be applied (e.g. wrong
   *  week, unknown code). Surfaces inline so the user knows the
   *  prefill was partial. */
  ignored?: ReadonlyArray<{ projectCode: string; dateIso: string; reason: string }>;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-brand bg-brand/10 px-3 py-2 text-xs text-ink">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span aria-hidden>✨</span>
          <div>
            <div className="font-medium text-ink">Prefilled by Assistant</div>
            <div className="text-ink-2">{summary}</div>
            <div className="mt-1 text-[11px] italic text-ink-3">
              Nothing is saved yet — review the fields and submit normally.
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            href={cleanUrl}
            className="rounded-md border border-line bg-card px-2 py-1 text-[11px] font-medium text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            Undo
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-md p-1 text-ink-3 hover:bg-surface-hover hover:text-ink"
            aria-label="Dismiss banner"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
      {ignored && ignored.length > 0 ? (
        <ul className="ml-5 list-disc text-[11px] text-status-amber">
          {ignored.map((i, idx) => (
            <li key={idx}>
              Skipped <code>{i.projectCode}</code> {i.dateIso} —{' '}
              {i.reason === 'unknown_project'
                ? 'unknown project code'
                : i.reason === 'outside_visible_range'
                  ? 'date outside the visible week'
                  : i.reason === 'locked_row'
                    ? 'row already approved / billed'
                    : i.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
