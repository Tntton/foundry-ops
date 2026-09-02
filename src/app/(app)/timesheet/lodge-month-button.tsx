'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { lodgeMonth, type TimesheetLodgeState } from './actions';
import { Button } from '@/components/ui/button';

/**
 * The month's primary action: lodge it for approval.
 *
 * Two-step by design. The first click runs the server-side preflight; if it
 * finds anything worth a second look (an unfinished month, weekdays with no
 * hours, projects the person isn't rostered on) the action returns those
 * warnings WITHOUT writing, and the button becomes an explicit "Lodge
 * anyway". A hard blocker — no hours at all, or a month already approved —
 * comes back as a plain error and no amount of clicking gets past it.
 *
 * The check lives on the server, not here: a client-side confirm is trivially
 * bypassed and would let a half-empty month reach the approval queue.
 */
export function LodgeMonthButton({
  targetPersonId,
  year,
  month,
  monthLabel,
  totalHours,
  projectCount,
  state,
  disabledReason,
}: {
  targetPersonId: string;
  year: number;
  month: number;
  monthLabel: string;
  totalHours: number;
  projectCount: number;
  state: 'open' | 'lodged' | 'approved' | 'invoiced';
  disabledReason: string | null;
}) {
  const [result, action] = useFormState<TimesheetLodgeState, FormData>(lodgeMonth, {
    status: 'idle',
  });

  const needsAck = result.status === 'warn';
  const settled = state === 'approved' || state === 'invoiced';

  return (
    <div className="rounded-lg border border-line bg-surface-elev p-3">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="targetPersonId" value={targetPersonId} />
        <input type="hidden" name="year" value={year} />
        <input type="hidden" name="month" value={month} />
        <input type="hidden" name="acknowledge" value={needsAck ? 'true' : 'false'} />

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink">
            {settled
              ? `${monthLabel} is ${state}`
              : state === 'lodged'
                ? `${monthLabel} is with the approvers`
                : `Lodge ${monthLabel}`}
          </div>
          <div className="text-xs text-ink-3">
            {totalHours.toFixed(1)}h across {projectCount}{' '}
            {projectCount === 1 ? 'project' : 'projects'}
            {state === 'lodged' && ' · lodging again picks up anything added since'}
          </div>
        </div>

        {!settled && (
          <SubmitButton
            label={
              needsAck
                ? 'Lodge anyway'
                : state === 'lodged'
                  ? 'Re-lodge'
                  : 'Lodge month'
            }
            variant={needsAck ? 'outline' : 'default'}
            disabled={disabledReason !== null}
          />
        )}
      </form>

      {disabledReason !== null && (
        <p className="mt-2 text-xs text-ink-3">{disabledReason}</p>
      )}

      {result.status === 'warn' && (
        <div className="mt-3 rounded-md border border-status-amber/40 bg-status-amber/5 p-2">
          <p className="text-xs font-medium text-status-amber">{result.message}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-2">
            {result.warnings.map((w) => (
              <li key={w.code}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}

      {result.status === 'error' && (
        <p className="mt-2 text-xs text-status-red">{result.message}</p>
      )}

      {result.status === 'success' && (
        <p className="mt-2 text-xs text-status-green">{result.message}</p>
      )}
    </div>
  );
}

function SubmitButton({
  label,
  variant,
  disabled,
}: {
  label: string;
  variant: 'default' | 'outline';
  disabled: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} disabled={pending || disabled}>
      {pending ? 'Lodging…' : label}
    </Button>
  );
}
