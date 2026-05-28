'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import {
  addProjectTeamMember,
  removeProjectTeamMember,
  type TeamQuickAddState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type PersonOption = {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
  band: string;
};

export function TeamQuickAdd({
  projectId,
  options,
}: {
  projectId: string;
  options: PersonOption[];
}) {
  const bound = addProjectTeamMember.bind(null, projectId);
  const [state, action] = useFormState<TeamQuickAddState, FormData>(bound, {
    status: 'idle',
  });
  const [open, setOpen] = useState(false);
  const [personId, setPersonId] = useState('');
  const [role, setRole] = useState('');
  const [pct, setPct] = useState('25');

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        + Add team member
      </Button>
    );
  }

  return (
    <form
      action={action}
      onSubmit={() => {
        // Snap state back to closed after server returns; we keep useState in
        // sync via the message badge below.
        setTimeout(() => {
          setPersonId('');
          setRole('');
        }, 0);
      }}
      className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-card p-3"
    >
      <select
        name="personId"
        value={personId}
        onChange={(e) => setPersonId(e.target.value)}
        required
        className="h-9 min-w-[220px] rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
      >
        <option value="">— Choose person —</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.initials} · {p.firstName} {p.lastName} ({p.band})
          </option>
        ))}
      </select>
      <Input
        name="roleOnProject"
        placeholder="Role on project (e.g. Lead, Analyst)"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        required
        className="min-w-[200px]"
      />
      <div className="flex items-center gap-1 text-xs text-ink-3">
        <Input
          name="allocationPct"
          type="number"
          min="0"
          max="100"
          step="5"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
          required
          className="h-9 w-[80px] text-center"
        />
        <span>%</span>
      </div>
      <SubmitBtn />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
      {state.status === 'error' && (
        <span className="text-xs text-status-red">{state.message}</span>
      )}
      {state.status === 'success' && (
        <span className="text-xs text-status-green">{state.message}</span>
      )}
    </form>
  );
}

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Adding…' : 'Add'}
    </Button>
  );
}

export function RemoveTeamMemberButton({
  projectId,
  personId,
  personName,
}: {
  projectId: string;
  personId: string;
  personName: string;
}) {
  const bound = removeProjectTeamMember.bind(null, projectId);
  const [state, action] = useFormState<TeamQuickAddState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="personId" value={personId} />
      <RemoveSubmit personName={personName} />
      {state.status === 'error' && (
        <span className="text-[10px] text-status-red">{state.message}</span>
      )}
    </form>
  );
}

function RemoveSubmit({ personName }: { personName: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      onClick={(e) => {
        if (!confirm(`Remove ${personName} from the team?`)) e.preventDefault();
      }}
      disabled={pending}
      className="text-[11px] text-ink-3 hover:text-status-red disabled:opacity-50"
    >
      {pending ? '…' : 'Remove'}
    </button>
  );
}
