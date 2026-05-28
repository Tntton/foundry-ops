'use client';

import { useFormState, useFormStatus } from 'react-dom';
import {
  submitInvoiceForApproval,
  recallInvoiceFromApproval,
  type InvoiceTransitionState,
} from './actions';
import { Button } from '@/components/ui/button';

export function SubmitForApprovalButton({ invoiceId }: { invoiceId: string }) {
  const bound = submitInvoiceForApproval.bind(null, invoiceId);
  const [state, action] = useFormState<InvoiceTransitionState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <SubmitBtn />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}
    </form>
  );
}

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Submitting…' : 'Submit for approval'}
    </Button>
  );
}

export function RecallFromApprovalButton({ invoiceId }: { invoiceId: string }) {
  const bound = recallInvoiceFromApproval.bind(null, invoiceId);
  const [state, action] = useFormState<InvoiceTransitionState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <RecallBtn />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}
    </form>
  );
}

function RecallBtn() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={(e) => {
        if (!confirm('Recall from approval queue and return to draft?')) {
          e.preventDefault();
        }
      }}
    >
      {pending ? 'Recalling…' : 'Recall to draft'}
    </Button>
  );
}
