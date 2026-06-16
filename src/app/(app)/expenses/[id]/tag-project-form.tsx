'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { tagExpenseProject, type TagProjectState } from './actions';
import { Button } from '@/components/ui/button';

const initial: TagProjectState = { status: 'idle' };

export function TagProjectForm({
  expenseId,
  currentProjectId,
  options,
}: {
  expenseId: string;
  currentProjectId: string | null;
  options: Array<{ id: string; code: string; name: string }>;
}) {
  const [state, action] = useFormState(
    tagExpenseProject.bind(null, expenseId),
    initial,
  );
  return (
    <form action={action} className="space-y-2 text-sm">
      <label htmlFor={`project-${expenseId}`} className="text-xs text-ink-3">
        Tag a project. Use{' '}
        <span className="font-mono">FHB000</span> (BD),{' '}
        <span className="font-mono">FHO000</span> (Ops), or{' '}
        <span className="font-mono">FHX000</span> (Other) for non-client
        expenses. Internal FH initiatives have their own codes (e.g.{' '}
        <span className="font-mono">FHP000</span>,{' '}
        <span className="font-mono">FHP001</span>). Anyone can re-allocate
        until approval — admin can still override at the approval gate.
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={`project-${expenseId}`}
          name="projectId"
          defaultValue={currentProjectId ?? ''}
          className="h-8 min-w-[240px] rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
        >
          <option value="">— Pick a project —</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
        <SaveButton />
      </div>
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">Saved.</p>
      )}
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}
