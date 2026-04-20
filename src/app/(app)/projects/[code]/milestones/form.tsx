'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createMilestone, updateMilestoneStatus, type MilestoneState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const STATUSES = ['not_started', 'in_progress', 'delivered', 'invoiced'] as const;

export function NewMilestoneForm({ projectId }: { projectId: string }) {
  const [state, action] = useFormState<MilestoneState, FormData>(createMilestone, {
    status: 'idle',
  });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-3 rounded-lg border border-line bg-card p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Add milestone</h2>
      <input type="hidden" name="projectId" value={projectId} />
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <Input name="label" required placeholder="Milestone 1 — Kickoff deck" />
        <Input name="dueDate" type="date" required defaultValue={today} />
        <Input
          name="amountDollars"
          type="number"
          min="0"
          step="1"
          required
          placeholder="Amount (AUD)"
          className="text-right"
        />
        <select
          name="status"
          defaultValue="not_started"
          className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <AddButton />
      </div>
    </form>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Adding…' : 'Add'}
    </Button>
  );
}

export function UpdateMilestoneStatus({
  milestoneId,
  status,
}: {
  milestoneId: string;
  status: string;
}) {
  const [, action] = useFormState<MilestoneState, FormData>(updateMilestoneStatus, {
    status: 'idle',
  });
  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="milestoneId" value={milestoneId} />
      <select
        name="status"
        defaultValue={status}
        onChange={(e) => {
          const form = e.currentTarget.closest('form');
          if (form) form.requestSubmit();
        }}
        className="h-7 rounded-md border border-line bg-surface-elev px-2 text-xs text-ink"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.replace('_', ' ')}
          </option>
        ))}
      </select>
    </form>
  );
}
