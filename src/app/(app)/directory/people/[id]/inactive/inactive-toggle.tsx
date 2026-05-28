'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { setPersonInactive, type InactiveState } from './actions';

/**
 * One-click "Pause" / "Resume" toggle. Self-edit always allowed; admin
 * roles can toggle anyone. Pausing surfaces a 1-line confirm prompt so
 * accidental clicks don't immediately disable the person's inputs.
 *
 * After a pause, the page rerenders with the inactive banner and the
 * editor / timesheet inputs locked. Resume is the inverse — no prompt,
 * since reactivating is harmless.
 */
export function InactiveToggleButton({
  personId,
  isInactive,
  isSelf,
  personFirstName,
}: {
  personId: string;
  isInactive: boolean;
  isSelf: boolean;
  personFirstName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<InactiveState>({ status: 'idle' });

  function pause() {
    const subject = isSelf ? 'yourself' : personFirstName;
    const ok = window.confirm(
      `Mark ${subject} inactive? All inputs (timesheet, availability, expenses) will be disabled until ${
        isSelf ? 'you' : 'they'
      } reactivate. ${
        isSelf ? 'You' : 'They'
      } stay listed in the directory and resource-planning pool.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const result = await setPersonInactive(personId, true, state, new FormData());
      setState(result);
    });
  }

  function resume() {
    startTransition(async () => {
      const result = await setPersonInactive(
        personId,
        false,
        state,
        new FormData(),
      );
      setState(result);
    });
  }

  if (isInactive) {
    return (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={resume}
          disabled={pending}
        >
          {pending ? 'Reactivating…' : 'Reactivate'}
        </Button>
        {state.status === 'error' && (
          <span className="text-xs text-status-red">{state.message}</span>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={pause}
        disabled={pending}
      >
        {pending ? 'Pausing…' : isSelf ? 'Mark me inactive' : 'Mark inactive'}
      </Button>
      {state.status === 'error' && (
        <span className="text-xs text-status-red">{state.message}</span>
      )}
    </div>
  );
}
