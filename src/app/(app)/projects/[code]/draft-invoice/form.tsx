'use client';

import { useFormState, useFormStatus } from 'react-dom';
import {
  createInvoiceFromTimesheets,
  type DraftFromTimeState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function DraftInvoiceFromTimeForm({
  projectId,
  defaultStart,
  defaultEnd,
  disabled,
}: {
  projectId: string;
  defaultStart: string;
  defaultEnd: string;
  disabled: boolean;
}) {
  const [state, action] = useFormState<DraftFromTimeState, FormData>(
    createInvoiceFromTimesheets,
    { status: 'idle' },
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid grid-cols-[1fr_1fr] gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Period start
          <Input name="periodStart" type="date" required defaultValue={defaultStart} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Period end (exclusive)
          <Input name="periodEnd" type="date" required defaultValue={defaultEnd} />
        </label>
      </div>
      {state.status === 'error' && (
        <p className="text-sm text-status-red">{state.message}</p>
      )}
      <Submit disabled={disabled} />
    </form>
  );
}

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? 'Drafting…' : 'Create draft invoice'}
    </Button>
  );
}
