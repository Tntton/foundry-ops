'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { RecruitStatus, RecruitTargetBand } from '@prisma/client';
import {
  moveRecruit,
  startPromotionToPerson,
  type MoveRecruitState,
} from '../actions';
import { Button } from '@/components/ui/button';

const idle: MoveRecruitState = { status: 'idle' };

const TARGET_BAND_LABELS: Record<RecruitTargetBand, string> = {
  senior_leader: 'Senior Leader',
  expert: 'Expert',
  fellow: 'Fellow',
  manager: 'Manager',
  consultant: 'Consultant',
  analyst: 'Analyst',
};
const TARGET_BAND_ORDER: RecruitTargetBand[] = [
  'senior_leader',
  'expert',
  'fellow',
  'manager',
  'consultant',
  'analyst',
];

/**
 * Move-band strip — five buttons, one per target band. Clicking the
 * current band is a no-op (the action diffs against the existing
 * value before patching). Disabled state shows the current band so
 * admin can see "where it is now" without consulting the header chip.
 */
export function MoveBandStrip({
  recruitId,
  currentBand,
}: {
  recruitId: string;
  currentBand: RecruitTargetBand;
}) {
  const [state, action] = useFormState<MoveRecruitState, FormData>(
    moveRecruit,
    idle,
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={recruitId} />
      {TARGET_BAND_ORDER.map((b) => (
        <button
          key={b}
          type="submit"
          name="targetBand"
          value={b}
          disabled={b === currentBand}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            b === currentBand
              ? 'cursor-default border-brand bg-brand text-brand-ink'
              : 'border-line bg-card text-ink-2 hover:border-brand hover:bg-surface-hover'
          }`}
        >
          {TARGET_BAND_LABELS[b]}
        </button>
      ))}
      {state.status === 'error' && (
        <span className="text-xs text-status-red">{state.message}</span>
      )}
      {state.status === 'success' && (
        <span className="text-xs text-status-green">Moved.</span>
      )}
    </form>
  );
}

/**
 * Nix / restore button — flips status between 'active' and 'nixed'.
 * Renders as red ("Nix") when active, green ("Restore to pipeline")
 * when nixed.
 */
export function NixToggleButton({
  recruitId,
  currentStatus,
}: {
  recruitId: string;
  currentStatus: RecruitStatus;
}) {
  const [state, action] = useFormState<MoveRecruitState, FormData>(
    moveRecruit,
    idle,
  );
  const nextStatus: RecruitStatus =
    currentStatus === 'nixed' ? 'active' : 'nixed';
  const isNix = nextStatus === 'nixed';
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={recruitId} />
      <input type="hidden" name="status" value={nextStatus} />
      <NixSubmit isNix={isNix} />
      {state.status === 'error' && (
        <span className="text-xs text-status-red">{state.message}</span>
      )}
    </form>
  );
}

function NixSubmit({ isNix }: { isNix: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={isNix ? 'destructive' : 'outline'}
      disabled={pending}
    >
      {pending
        ? '…'
        : isNix
          ? 'Nix prospect'
          : 'Restore to pipeline'}
    </Button>
  );
}

/**
 * Promote-to-Person button. Server action redirects to
 * /directory/people/new?fromRecruit=<id> — that flow pre-fills the
 * new-person form with the prospect's details, and on submit
 * back-links the recruit row (sets linkedPersonId + status='converted').
 */
export function PromoteToPersonButton({ recruitId }: { recruitId: string }) {
  const [, action] = useFormState<MoveRecruitState, FormData>(
    startPromotionToPerson,
    idle,
  );
  return (
    <form action={action} className="inline-flex">
      <input type="hidden" name="id" value={recruitId} />
      <PromoteSubmit />
    </form>
  );
}

function PromoteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? '…' : 'Promote to team member →'}
    </Button>
  );
}
