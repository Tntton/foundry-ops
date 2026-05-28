'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useRef } from 'react';
import { decideTimesheetEntries, type TimesheetSaveState } from '../actions';
import { Button } from '@/components/ui/button';

/**
 * "Approve all pending" mass-action button. Lives at the top of the
 * approve page so a trusting manager / partner can clear an entire
 * week's queue in one decision when there's nothing to flag.
 *
 * Safety guards:
 *   - A native confirm() dialog summarises the impact ("N entries /
 *     Hh across P people") before any mutation fires. One Cmd-Click
 *     can't bulk-approve by accident.
 *   - The button respects the server's per-entry gate: the action
 *     already filters non-decidable entries (entries on projects the
 *     viewer doesn't lead) on its side, so the list the page passes
 *     in is already scoped.
 *   - Disabled when totalEntries === 0 — no work to do.
 *
 * Bulk note: stamped automatically as "Bulk-approved via approve-
 * all queue" so the audit trail can grep for which decisions came
 * from this fast path vs the per-card flow.
 */
export function ApproveAllPendingButton({
  entryIds,
  totalHours,
  peopleCount,
}: {
  entryIds: string[];
  totalHours: number;
  peopleCount: number;
}) {
  const [state, action] = useFormState<TimesheetSaveState, FormData>(
    decideTimesheetEntries,
    { status: 'idle' },
  );
  const formRef = useRef<HTMLFormElement>(null);

  const totalEntries = entryIds.length;

  function onClickApprove(e: React.MouseEvent<HTMLButtonElement>) {
    if (totalEntries === 0) return;
    const ok = window.confirm(
      `Approve all ${totalEntries} pending entr${totalEntries === 1 ? 'y' : 'ies'} ` +
        `(${totalHours.toFixed(1)}h across ${peopleCount} ` +
        `${peopleCount === 1 ? 'person' : 'people'})?\n\n` +
        `This is irreversible — each approved entry locks its project P&L. ` +
        `Cancel + use the per-card buttons if you want to review individual rows first.`,
    );
    if (!ok) {
      e.preventDefault();
    }
  }

  return (
    <form ref={formRef} action={action} className="contents">
      {entryIds.map((id) => (
        <input key={id} type="hidden" name="entryId" value={id} />
      ))}
      <input type="hidden" name="decision" value="approved" />
      <input
        type="hidden"
        name="note"
        value="Bulk-approved via approve-all queue"
      />
      <ApproveAllSubmit
        totalEntries={totalEntries}
        totalHours={totalHours}
        onClick={onClickApprove}
      />
      {state.status === 'error' && (
        <span className="text-xs text-status-red">{state.message}</span>
      )}
      {state.status === 'success' && (
        <span className="text-xs text-status-green">{state.message}</span>
      )}
    </form>
  );
}

function ApproveAllSubmit({
  totalEntries,
  totalHours,
  onClick,
}: {
  totalEntries: number;
  totalHours: number;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      onClick={onClick}
      disabled={pending || totalEntries === 0}
    >
      {pending
        ? 'Approving…'
        : `✓ Approve all (${totalEntries} · ${totalHours.toFixed(1)}h)`}
    </Button>
  );
}
