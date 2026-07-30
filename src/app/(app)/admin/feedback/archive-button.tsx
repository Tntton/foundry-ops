'use client';

import { useState, useTransition } from 'react';
import { setFeedbackArchived } from './actions';

/**
 * Archive / un-archive control for a COMPLETED feedback ticket. Archiving
 * clears it out of the "ready to archive" lane into the collapsed
 * Archived section; un-archiving brings it back. Kept as its own tiny
 * client component so the (server) page stays server-rendered.
 */
export function ArchiveButton({
  id,
  archived,
}: {
  id: string;
  archived: boolean;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function toggle() {
    setErr(null);
    start(async () => {
      const res = await setFeedbackArchived(id, !archived);
      if (res.status === 'error') setErr(res.message);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={
          archived
            ? 'rounded-md border border-line bg-surface-elev px-2.5 py-1 text-[11px] text-ink-2 hover:bg-surface-hover hover:text-ink disabled:opacity-40'
            : 'rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-brand-ink hover:opacity-90 disabled:opacity-40'
        }
        title={
          archived
            ? 'Bring this ticket back into the active view'
            : 'Archive this completed ticket — clears it from the active queue'
        }
      >
        {pending ? '…' : archived ? 'Unarchive' : 'Archive'}
      </button>
      {err && <span className="text-[11px] text-status-red">{err}</span>}
    </span>
  );
}
