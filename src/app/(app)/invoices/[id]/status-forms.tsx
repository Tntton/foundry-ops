'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import {
  markInvoiceSent,
  recordInvoicePayment,
  type InvoiceTransitionState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function MarkSentButton({ invoiceId }: { invoiceId: string }) {
  const bound = markInvoiceSent.bind(null, invoiceId);
  const [state, action] = useFormState<InvoiceTransitionState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <MarkSentSubmit />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}
    </form>
  );
}

function MarkSentSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Marking…' : 'Mark sent'}
    </Button>
  );
}

export function RecordPaymentForm({
  invoiceId,
  outstandingDollars,
}: {
  invoiceId: string;
  outstandingDollars: number;
}) {
  const bound = recordInvoicePayment.bind(null, invoiceId);
  const [state, action] = useFormState<InvoiceTransitionState, FormData>(bound, {
    status: 'idle',
  });
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Record payment
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2 rounded-md border border-line p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Amount (AUD inc GST)
          <Input
            name="amountDollars"
            type="number"
            min="0.01"
            step="0.01"
            defaultValue={outstandingDollars.toFixed(2)}
            required
            className="max-w-[160px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Paid on
          <Input name="paidOn" type="date" defaultValue={today} className="max-w-[160px]" />
        </label>
        <RecordSubmit />
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}
      <p className="text-[11px] text-ink-3">
        Outstanding: AUD {outstandingDollars.toFixed(2)}. Payment ≥ outstanding marks the
        invoice fully paid.
      </p>
    </form>
  );
}

function RecordSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Record'}
    </Button>
  );
}
