'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import {
  createInvoiceFromMilestones,
  type DraftFromMilestonesState,
} from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const STATUS_VARIANT: Record<string, 'outline' | 'amber' | 'green' | 'blue'> = {
  not_started: 'outline',
  in_progress: 'amber',
  delivered: 'green',
  invoiced: 'blue',
};

export type MilestoneOption = {
  id: string;
  label: string;
  dueDate: Date;
  amountCents: number;
  status: string;
};

export function DraftMilestoneInvoiceForm({
  projectId,
  milestones,
}: {
  projectId: string;
  milestones: MilestoneOption[];
}) {
  const [state, action] = useFormState<DraftFromMilestonesState, FormData>(
    createInvoiceFromMilestones,
    { status: 'idle' },
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectDelivered() {
    setSelected(
      new Set(
        milestones.filter((m) => m.status === 'delivered').map((m) => m.id),
      ),
    );
  }
  function selectAll() {
    setSelected(new Set(milestones.map((m) => m.id)));
  }

  const total = milestones
    .filter((m) => selected.has(m.id))
    .reduce((s, m) => s + m.amountCents, 0);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-2">
          {selected.size} selected · {formatMoney(total)} ex GST
        </span>
        {milestones.some((m) => m.status === 'delivered') && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={selectDelivered}
          >
            Select delivered
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={selectAll}>
          Select all ({milestones.length})
        </Button>
        {selected.size > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        )}
      </div>
      <ul className="space-y-1">
        {milestones.map((m) => {
          const checked = selected.has(m.id);
          return (
            <li
              key={m.id}
              className={`flex items-start gap-3 rounded-md border p-2 ${
                checked ? 'border-brand bg-brand/5' : 'border-line'
              }`}
            >
              <input
                type="checkbox"
                name="milestoneIds"
                value={m.id}
                checked={checked}
                onChange={() => toggle(m.id)}
                className="mt-1 h-4 w-4"
              />
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{m.label}</span>
                  <Badge
                    variant={STATUS_VARIANT[m.status] ?? 'outline'}
                    className="capitalize"
                  >
                    {m.status.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-xs text-ink-3">
                    due {m.dueDate.toLocaleDateString('en-AU')}
                  </span>
                </div>
              </div>
              <div className="text-right font-semibold tabular-nums text-ink">
                {formatMoney(m.amountCents)}
              </div>
            </li>
          );
        })}
      </ul>
      {state.status === 'error' && (
        <p className="text-sm text-status-red">{state.message}</p>
      )}
      <Submit disabled={selected.size === 0} />
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
