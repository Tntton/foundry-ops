'use client';

import { useFormState, useFormStatus } from 'react-dom';
import {
  updateDealConversationDates,
  type DealUpdateState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function DealConversationDatesForm({
  dealId,
  firstConversationAt,
  lastConversationAt,
}: {
  dealId: string;
  firstConversationAt: Date | null;
  lastConversationAt: Date | null;
}) {
  const bound = updateDealConversationDates.bind(null, dealId);
  const [state, action] = useFormState<DealUpdateState, FormData>(bound, {
    status: 'idle',
  });
  const first = firstConversationAt ? firstConversationAt.toISOString().slice(0, 10) : '';
  const last = lastConversationAt ? lastConversationAt.toISOString().slice(0, 10) : '';

  return (
    <form action={action} className="space-y-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <label className="text-xs text-ink-3">
          <span className="mb-1 block">First conversation</span>
          <Input name="firstConversationAt" type="date" defaultValue={first} />
        </label>
        <label className="text-xs text-ink-3">
          <span className="mb-1 block">Last conversation</span>
          <Input name="lastConversationAt" type="date" defaultValue={last} />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <SaveBtn />
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

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}
