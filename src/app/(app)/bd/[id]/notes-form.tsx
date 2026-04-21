'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { updateDealNotes, type DealUpdateState } from './actions';
import { Button } from '@/components/ui/button';

export function DealNotesForm({
  dealId,
  initialNotes,
}: {
  dealId: string;
  initialNotes: string;
}) {
  const bound = updateDealNotes.bind(null, dealId);
  const [state, action] = useFormState<DealUpdateState, FormData>(bound, { status: 'idle' });

  return (
    <form action={action} className="space-y-2">
      <textarea
        name="notes"
        rows={6}
        defaultValue={initialNotes}
        maxLength={4000}
        className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink"
        placeholder="Key contacts, competitive landscape, timeline, blockers…"
      />
      <div className="flex items-center gap-2">
        <Save />
        {state.status === 'error' && (
          <span className="text-xs text-status-red">{state.message}</span>
        )}
        {state.status === 'success' && (
          <span className="text-xs text-status-green">{state.message}</span>
        )}
      </div>
    </form>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Save notes'}
    </Button>
  );
}
