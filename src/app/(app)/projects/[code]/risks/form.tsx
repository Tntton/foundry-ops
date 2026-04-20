'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createRisk, updateRiskField, type RiskState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const SEVERITIES = ['low', 'medium', 'high'] as const;
const STATUSES = ['open', 'mitigating', 'closed'] as const;

type PersonOpt = { id: string; initials: string; firstName: string; lastName: string };

export function NewRiskForm({
  projectId,
  people,
}: {
  projectId: string;
  people: PersonOpt[];
}) {
  const [state, action] = useFormState<RiskState, FormData>(createRisk, { status: 'idle' });

  return (
    <form action={action} className="space-y-3 rounded-lg border border-line bg-card p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Log risk</h2>
      <input type="hidden" name="projectId" value={projectId} />
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}
      <Input name="title" required placeholder="Short risk description" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Select name="severity" defaultValue="medium" label="Severity">
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue="open" label="Status">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select name="ownerId" defaultValue="" label="Owner (optional)">
          <option value="">— None —</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.initials} · {p.firstName} {p.lastName}
            </option>
          ))}
        </Select>
      </div>
      <textarea
        name="mitigation"
        rows={3}
        placeholder="Mitigation plan / notes (optional)"
        className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="flex justify-end">
        <AddButton />
      </div>
    </form>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Adding…' : 'Add risk'}
    </Button>
  );
}

function Select({
  name,
  defaultValue,
  label,
  children,
}: {
  name: string;
  defaultValue: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-ink-3">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
      >
        {children}
      </select>
    </label>
  );
}

export function RiskInlineSelect({
  riskId,
  field,
  current,
  options,
}: {
  riskId: string;
  field: 'severity' | 'status';
  current: string;
  options: string[];
}) {
  const [, action] = useFormState<RiskState, FormData>(updateRiskField, { status: 'idle' });
  return (
    <form action={action} className="inline">
      <input type="hidden" name="riskId" value={riskId} />
      <input type="hidden" name="field" value={field} />
      <select
        name="value"
        defaultValue={current}
        onChange={(e) => {
          const form = e.currentTarget.closest('form');
          if (form) form.requestSubmit();
        }}
        className="h-6 rounded-md border border-line bg-surface-elev px-1 text-[11px] text-ink"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </form>
  );
}
