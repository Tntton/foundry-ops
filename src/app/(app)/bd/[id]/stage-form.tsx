'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { updateDealStage, type DealUpdateState } from './actions';
import { Button } from '@/components/ui/button';

const STAGES = [
  { v: 'lead', label: 'Lead' },
  { v: 'qualifying', label: 'Qualifying' },
  { v: 'proposal', label: 'Proposal' },
  { v: 'negotiation', label: 'Negotiation' },
  { v: 'won', label: 'Won' },
  { v: 'lost', label: 'Lost' },
] as const;

export function DealStageForm({
  dealId,
  currentStage,
}: {
  dealId: string;
  currentStage: string;
}) {
  const bound = updateDealStage.bind(null, dealId);
  const [state, action] = useFormState<DealUpdateState, FormData>(bound, { status: 'idle' });

  return (
    <form action={action} className="flex items-center gap-2">
      <select
        name="stage"
        defaultValue={currentStage}
        className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
      >
        {STAGES.map((s) => (
          <option key={s.v} value={s.v}>
            {s.label}
          </option>
        ))}
      </select>
      <Apply />
      {state.status === 'error' && (
        <span className="text-xs text-status-red">{state.message}</span>
      )}
      {state.status === 'success' && state.message !== 'No change.' && (
        <span className="text-xs text-status-green">{state.message}</span>
      )}
    </form>
  );
}

function Apply() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Updating…' : 'Update'}
    </Button>
  );
}
