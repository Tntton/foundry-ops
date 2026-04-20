'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { pushInvoiceXero, type InvoiceXeroPushState } from './actions';
import { Button } from '@/components/ui/button';

export function XeroPushInvoiceButton({
  invoiceId,
  alreadyPushed,
}: {
  invoiceId: string;
  alreadyPushed: boolean;
}) {
  const bound = pushInvoiceXero.bind(null, invoiceId);
  const [state, action] = useFormState<InvoiceXeroPushState, FormData>(bound, { status: 'idle' });
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
