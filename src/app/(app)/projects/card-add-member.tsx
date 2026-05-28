'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import {
  addProjectTeamMember,
  type TeamQuickAddState,
} from './[code]/team/actions';
import { Button } from '@/components/ui/button';

export type CardPersonOption = {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
  band: string;
};

/**
 * Compact "add team member" affordance that lives on a project card
 * (kanban + grid views on /projects). Renders as a small "+" pill
 * inside the avatar row; clicking expands an inline picker:
 *
 *   [— Add person —] [+ add]
 *
 * Submitting hits the same `addProjectTeamMember` server action the
 * project detail page uses, so audit + revalidation are consistent.
 * Defaults: role "Team", allocation 0% — the operator can refine on
 * the project's Team tab if needed. Already-on-team people are
 * filtered upstream so the dropdown only shows valid candidates.
 */
export function CardAddMember({
  projectId,
  options,
}: {
  projectId: string;
  options: CardPersonOption[];
}) {
  const bound = addProjectTeamMember.bind(null, projectId);
  const [state, action] = useFormState<TeamQuickAddState, FormData>(bound, {
    status: 'idle',
  });
  const [open, setOpen] = useState(false);
  const [personId, setPersonId] = useState('');

  if (options.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          // Stop the click bubbling up to the card's draggable surface
          // so we don't accidentally start a drag while opening the
          // picker.
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="Add team member"
        className="ml-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-dashed border-line bg-card text-[12px] font-semibold text-ink-3 hover:border-brand hover:text-brand"
      >
        +
      </button>
    );
  }

  return (
    <form
      action={action}
      onClick={(e) => e.stopPropagation()}
      className="ml-2 flex flex-wrap items-center gap-1 rounded-md border border-line bg-card p-1.5"
    >
      <input type="hidden" name="roleOnProject" value="Team" />
      <input type="hidden" name="allocationPct" value="0" />
      <select
        name="personId"
        value={personId}
        onChange={(e) => setPersonId(e.target.value)}
        required
        className="h-7 min-w-[180px] rounded border border-line bg-surface-elev px-1.5 text-xs text-ink"
      >
        <option value="">— Add person —</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.initials} · {p.firstName} {p.lastName}
          </option>
        ))}
      </select>
      <SubmitBtn />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => {
          setOpen(false);
          setPersonId('');
        }}
      >
        ✕
      </Button>
      {state.status === 'error' && (
        <span className="w-full text-[10px] text-status-red">
          {state.message}
        </span>
      )}
    </form>
  );
}

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      className="h-7 px-2 text-xs"
      disabled={pending}
    >
      {pending ? '…' : 'Add'}
    </Button>
  );
}
