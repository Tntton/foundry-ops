'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setCommercialsVisible } from '@/server/commercials-visible';

/**
 * Small toggle to flip the commercial-values visibility cookie. Lives
 * in the header bar of /projects and /bd. Defaults to hidden — partners
 * flip it on when reviewing commercials in private, off again before
 * a team huddle so $ amounts don't flash on the shared screen.
 */
export function CommercialsToggle({ visible, path }: { visible: boolean; path: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        start(async () => {
          await setCommercialsVisible(!visible, path);
          router.refresh();
        });
      }}
      title={visible ? 'Hide $ amounts (team-safe view)' : 'Show $ amounts (private review)'}
      className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
        visible
          ? 'border-status-amber bg-status-amber-soft text-status-amber hover:bg-status-amber-soft/80'
          : 'border-line bg-surface-elev text-ink-2 hover:bg-surface-hover hover:text-ink'
      }`}
    >
      {pending ? '…' : visible ? '$ visible' : '$ hidden'}
    </button>
  );
}
