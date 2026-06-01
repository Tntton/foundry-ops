'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { RecruitTargetBand } from '@prisma/client';
import { createRecruitQuick, type QuickAddState } from './actions';

/**
 * Inline quick-add affordance for the stage-based talent kanban.
 * Lives in the Screening column (new prospects start there). Compact
 * form: first + last name, target band picker, FH responsible contact
 * (owner) picker. Pre-fills owner = the logged-in admin.
 *
 * Keyboard:
 *   - Enter in last-name field submits.
 *   - Escape collapses + clears.
 */

export type QuickAddOwner = {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
};

const idle: QuickAddState = { status: 'idle' };

const BAND_OPTIONS: { value: RecruitTargetBand; label: string }[] = [
  { value: 'senior_leader', label: 'Senior Leader' },
  { value: 'expert', label: 'Expert' },
  { value: 'fellow', label: 'Fellow' },
  { value: 'manager', label: 'Manager' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'analyst', label: 'Analyst' },
];

export function KanbanQuickAdd({
  owners,
  defaultOwnerId,
}: {
  owners: QuickAddOwner[];
  defaultOwnerId: string;
}) {
  const [state, action] = useFormState<QuickAddState, FormData>(
    createRecruitQuick,
    idle,
  );
  const [expanded, setExpanded] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [band, setBand] = useState<RecruitTargetBand>('consultant');
  const [ownerId, setOwnerId] = useState<string>(defaultOwnerId);
  const [lastAdded, setLastAdded] = useState<{ id: string; name: string } | null>(
    null,
  );
  const firstNameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (expanded) firstNameRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    if (state.status === 'success') {
      setLastAdded({
        id: state.recruitId,
        name: `${firstName} ${lastName}`.trim(),
      });
      setFirstName('');
      setLastName('');
      // Keep band + owner choices so admin can rapid-fire same-tier hires
      firstNameRef.current?.focus();
    }
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
        className="mt-2 w-full rounded-md border border-dashed border-line bg-transparent px-3 py-2 text-[11px] text-ink-3 transition-colors hover:border-brand hover:bg-surface-hover hover:text-brand"
      >
        + Add prospect
      </button>
    );
  }

  return (
    <form
      action={action}
      className="mt-2 space-y-2 rounded-md border border-brand bg-surface-hover p-2"
      aria-label="Add prospect to Screening"
    >
      <input
        ref={firstNameRef}
        name="firstName"
        value={firstName}
        onChange={(e) => setFirstName(e.target.value)}
        onKeyDown={onKeyDown}
        required
        maxLength={100}
        placeholder="First name"
        className="h-7 w-full rounded-md border border-line bg-surface-elev px-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <input
        name="lastName"
        value={lastName}
        onChange={(e) => setLastName(e.target.value)}
        onKeyDown={onKeyDown}
        required
        maxLength={100}
        placeholder="Last name"
        className="h-7 w-full rounded-md border border-line bg-surface-elev px-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <select
        name="targetBand"
        value={band}
        onChange={(e) => setBand(e.target.value as RecruitTargetBand)}
        className="h-7 w-full rounded-md border border-line bg-surface-elev px-1.5 text-xs text-ink"
      >
        {BAND_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <select
        name="ownerId"
        value={ownerId}
        onChange={(e) => setOwnerId(e.target.value)}
        className="h-7 w-full rounded-md border border-line bg-surface-elev px-1.5 text-xs text-ink"
        title="FH responsible contact"
      >
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.firstName} {o.lastName} ({o.initials})
          </option>
        ))}
      </select>
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
