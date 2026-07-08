'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createTestProject, type NewTestProjectState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function NewTestProjectForm({ defaultName }: { defaultName: string }) {
  const [state, action] = useFormState<NewTestProjectState, FormData>(
    createTestProject,
    { status: 'idle' },
  );

  return (
    <form action={action} className="space-y-4 rounded-lg border border-line bg-card p-5">
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}
      <label className="block space-y-1">
        <span className="text-xs font-medium text-ink-3">Name</span>
        <Input
          name="name"
          required
          minLength={3}
          maxLength={200}
          defaultValue={defaultName}
        />
      </label>
      <p className="text-[11px] text-ink-3">
        The project code (TST002, TST003, …) is assigned automatically.
        You&apos;ll be the manager and on the team, so it appears in your
        timesheet straight away.
      </p>
      <div className="flex justify-end">
        <SubmitBtn />
      </div>
    </form>
  );
}

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Creating…' : 'Create practice project'}
    </Button>
  );
}
