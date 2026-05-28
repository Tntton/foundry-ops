'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { promoteSubmittedToApproved, type TimesheetPromoteState } from './actions';
import { Button } from '@/components/ui/button';

/**
 * Backlog cleanup button — promotes every `submitted` entry on the visible
 * sheet (one person × one date range) to `approved`. Surfaced when:
 *   - the viewer can act on behalf (super_admin / admin / manager / partner)
 *   - and the loaded grid contains at least one submitted row
 *
 * Live auto-approve in saveTimesheet covers new saves; this handles entries
 * that were submitted *before* the auto-approve rule went in.
 */
export function PromoteSubmittedButton({
  targetPersonId,
  rangeStart,
  dayCount,
  submittedCount,
}: {
  targetPersonId: string;
  rangeStart: string;
  dayCount: number;
  submittedCount: number;
}) {
  const [state, action] = useFormState<TimesheetPromoteState, FormData>(
    promoteSubmittedToApproved,
    { status: 'idle' },
  );
  if (submittedCount === 0) return null;

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="targetPersonId" value={targetPersonId} />
      <input type="hidden" name="rangeStart" value={rangeStart} />
      <input type="hidden" name="dayCount" value={dayCount} />
      <SubmitBtn count={submittedCount} />
      {state.status === 'error' && (
        <span className="text-[11px] text-status-red">{state.message}</span>
      )}
      {state.status === 'success' && (
        <span className="text-[11px] text-status-green">{state.message}</span>
      )}
    </form>
  );
}

function SubmitBtn({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={(e) => {
        if (
          !confirm(
            `Approve ${count} submitted ${count === 1 ? 'entry' : 'entries'} on this sheet? They’ll skip the queue and land in project P&L immediately.`,
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      {pending
        ? 'Approving…'
        : `Approve ${count} submitted ${count === 1 ? 'entry' : 'entries'}`}
    </Button>
  );
}
