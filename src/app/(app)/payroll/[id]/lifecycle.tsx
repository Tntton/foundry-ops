'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import {
  approvePayRun,
  deleteDraftPayRun,
  markPayRunAbaGenerated,
  markPayRunPaid,
  type PayRunActionState,
} from './actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function ApproveButton({ payRunId }: { payRunId: string }) {
  const bound = approvePayRun.bind(null, payRunId);
  const [state, action] = useFormState<PayRunActionState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <Submit label="Approve pay-run" variant="default" />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}
    </form>
  );
}

export function MarkAbaGeneratedButton({ payRunId }: { payRunId: string }) {
  const bound = markPayRunAbaGenerated.bind(null, payRunId);
  const [state, action] = useFormState<PayRunActionState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <Submit label="Mark ABA generated" variant="outline" />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}
    </form>
  );
}

export function MarkPaidButton({ payRunId }: { payRunId: string }) {
  const bound = markPayRunPaid.bind(null, payRunId);
  const [state, action] = useFormState<PayRunActionState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <Submit label="Mark paid" variant="default" />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}
    </form>
  );
}

export function DeleteDraftButton({ payRunId }: { payRunId: string }) {
  const bound = deleteDraftPayRun.bind(null, payRunId);
  const [state, action] = useFormState<PayRunActionState, FormData>(bound, {
    status: 'idle',
  });
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Delete draft
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this draft pay-run?</DialogTitle>
          <DialogDescription>
            Removes the pay-run and returns all linked bills to status{' '}
            <span className="font-mono">approved</span>. Audited.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-2">
          {state.status === 'error' && (
            <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
              {state.message}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Submit label="Delete" variant="destructive" />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Submit({
  label,
  variant,
}: {
  label: string;
  variant: 'default' | 'outline' | 'destructive';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending}>
      {pending ? 'Working…' : label}
    </Button>
  );
}
