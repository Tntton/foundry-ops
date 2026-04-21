'use client';

import { useFormState, useFormStatus } from 'react-dom';
import {
  markBillPaid,
  scheduleBillForPayment,
  type BillTransitionState,
} from './actions';
import { Button } from '@/components/ui/button';

export function ScheduleBillButton({ billId }: { billId: string }) {
  const bound = scheduleBillForPayment.bind(null, billId);
  const [state, action] = useFormState<BillTransitionState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <ScheduleSubmit />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}
    </form>
  );
}

function ScheduleSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Scheduling…' : 'Schedule for payment'}
    </Button>
  );
}

export function MarkBillPaidButton({ billId }: { billId: string }) {
  const bound = markBillPaid.bind(null, billId);
  const [state, action] = useFormState<BillTransitionState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <PaidSubmit />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}
    </form>
  );
}

function PaidSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Mark paid'}
    </Button>
  );
}
