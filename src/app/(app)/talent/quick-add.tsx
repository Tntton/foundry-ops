'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { RecruitTargetBand } from '@prisma/client';
import { createRecruitQuick, type QuickAddState } from './actions';

/**
 * Inline quick-add at the bottom of each kanban pool column.
 *
 * Default state: a discreet "+ Add prospect" pill. Click expands
 * the row into two name inputs + an Add button. Submit creates
 * the prospect with the column's `band` pre-set, owner defaulted
 * to the logged-in admin, and stays on the board (no redirect).
 * The form clears + collapses on success so admin can keep adding;
 * a brief "✓ added" affordance with a deep-link to the detail
 * page surfaces under the row for the just-added card.
 *
 * Keyboard:
 *  - Enter in either name field submits.
 *  - Escape collapses + clears.
 */
const idle: QuickAddState = { status: 'idle' };

export function QuickAddInColumn({
  band,
  bandLabel,
}: {
  band: RecruitTargetBand;
  bandLabel: string;
}) {
  const [state, action] = useFormState<QuickAddState, FormData>(
    createRecruitQuick,
    idle,
  );
  const [expanded, setExpanded] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [lastAdded, setLastAdded] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const firstNameRef = useRef<HTMLInputElement | null>(null);

  // Focus the first-name field as soon as the form expands.
  useEffect(() => {
    if (expanded) firstNameRef.current?.focus();
  }, [expanded]);

  // After a successful create, capture the new card's id + name for
  // the inline "Open ↗" link, clear the inputs, and stay expanded
  // so admin can keep adding rapid-fire without re-clicking the
  // expand affordance.
  useEffect(() => {
    if (state.status === 'success') {
      setLastAdded({
        id: state.recruitId,
        name: `${firstName} ${lastName}`.trim(),
      });
      setFirstName('');
      setLastName('');
      firstNameRef.current?.focus();
    }
    // We intentionally only fire on a successful state transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function collapse() {
    setExpanded(false);
    setFirstName('');
    setLastName('');
    setLastAdded(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      collapse();
    }
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-1 w-full rounded-md border border-dashed border-line bg-transparent px-3 py-1.5 text-[11px] text-ink-3 transition-colors hover:border-brand hover:bg-surface-hover hover:text-brand"
      >
        + Add prospect
      </button>
    );
  }

  return (
    <form
      action={action}
      className="mt-1 space-y-1.5 rounded-md border border-brand bg-surface-hover p-2"
      aria-label={`Add prospect to ${bandLabel}`}
    >
      <input type="hidden" name="targetBand" value={band} />
      <input
        ref={firstNameRef}
        name="firstName"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        onKeyDown={onKeyDown}
        required
        maxLength={100}
        placeholder="First name"
        className="h-7 w-full rounded-md border border-line bg-surface-elev px-2 text-xs text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <input
        name="lastName"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
        onKeyDown={onKeyDown}
        required
        maxLength={100}
        placeholder="Last name"
        className="h-7 w-full rounded-md border border-line bg-surface-elev px-2 text-xs text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={collapse}
          className="text-[10px] text-ink-3 hover:text-ink"
        >
          Cancel · Esc
        </button>
        <Submit />
      </div>
      {state.status === 'error' && (
        <p className="text-[10px] text-status-red">{state.message}</p>
      )}
      {/* Stays visible until the form is cancelled / next add fires;
          gives admin a one-click jump into the detail page to fill
          in source / stage / notes if the prospect needs more than
          just a name. */}
      {lastAdded && (
        <p className="text-[10px] text-status-green">
          ✓ Added {lastAdded.name} ·{' '}
          <Link
            href={`/talent/${lastAdded.id}`}
            className="text-brand hover:underline"
          >
            Open ↗
          </Link>
        </p>
      )}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand px-3 py-1 text-[11px] font-medium text-brand-ink shadow-sm hover:bg-brand/90 disabled:opacity-60"
    >
      {pending ? 'Adding…' : 'Add'}
    </button>
  );
}
