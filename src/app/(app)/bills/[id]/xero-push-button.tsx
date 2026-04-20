'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { pushBillXero, type BillXeroPushState } from './actions';
import { Button } from '@/components/ui/button';

export function XeroPushBillButton({
  billId,
  alreadyPushed,
}: {
  billId: string;
  alreadyPushed: boolean;
}) {
  const bound = pushBillXero.bind(null, billId);
  const [state, action] = useFormState<BillXeroPushState, FormData>(bound, { status: 'idle' });
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <PushButton alreadyPushed={alreadyPushed} />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}
    </form>
  );
}

function PushButton({ alreadyPushed }: { alreadyPushed: boolean }) {
  const { pending } = useFormStatus();
  const label = alreadyPushed ? 'Re-push to Xero' : 'Push to Xero';
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Pushing…' : label}
    </Button>
  );
}
