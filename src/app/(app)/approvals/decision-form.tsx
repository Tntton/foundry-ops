'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { decideApproval, type DecisionState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function DecisionForm({ approvalId }: { approvalId: string }) {
  const [state, action] = useFormState<DecisionState, FormData>(decideApproval, {
    status: 'idle',
  });
  const [mode, setMode] = useState<'hidden' | 'approve' | 'reject'>('hidden');

  if (state.status === 'error') {
    return <p className="text-xs text-status-red">{state.message}</p>;
  }

  if (mode === 'hidden') {
    return (
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setMode('reject')}>
          Reject
        </Button>
        <Button type="button" size="sm" onClick={() => setMode('approve')}>
          Approve
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="approvalId" value={approvalId} />
      <input type="hidden" name="decision" value={mode === 'approve' ? 'approved' : 'rejected'} />
      <Input
        name="note"
        placeholder={mode === 'reject' ? 'Reason (required)' : 'Note (optional)'}
        required={mode === 'reject'}
        className="min-w-[240px]"
      />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode('hidden')}>
          Cancel
        </Button>
        <SubmitButton mode={mode} />
      </div>
    </form>
  );
}

function SubmitButton({ mode }: { mode: 'approve' | 'reject' }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={mode === 'reject' ? 'destructive' : 'default'}
      disabled={pending}
    >
      {pending ? '…' : mode === 'reject' ? 'Confirm reject' : 'Confirm approve'}
    </Button>
  );
}
