'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import {
  createInvoiceFromMilestones,
  type DraftFromMilestonesState,
} from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { RebillableCost } from '@/server/invoice-drafter';

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
  rebillableCosts,
}: {
  projectId: string;
  milestones: MilestoneOption[];
  rebillableCosts: RebillableCost[];
}) {
  const [state, action] = useFormState<DraftFromMilestonesState, FormData>(
    createInvoiceFromMilestones,
    { status: 'idle' },
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedCosts, setSelectedCosts] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        rebillableCosts.map((c) => [`${c.kind}:${c.id}`, true]),
      ),
  );

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
  const selectedCostsTotal = rebillableCosts
    .filter((c) => selectedCosts[`${c.kind}:${c.id}`])
    .reduce((s, c) => s + c.amountExGstCents, 0);
  const grandTotal = total + selectedCostsTotal;
  const submitDisabled =
    selected.size === 0 &&
    !rebillableCosts.some((c) => selectedCosts[`${c.kind}:${c.id}`]);

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
      {rebillableCosts.length > 0 && (
        <fieldset className="space-y-2 rounded-md border border-status-amber/40 bg-status-amber-soft/20 px-3 py-2">
          <legend className="px-1 text-xs font-medium uppercase tracking-wide text-status-amber">
            Pass-through costs · {rebillableCosts.length}
          </legend>
          <p className="text-[11px] text-ink-3">
            Bills + reimbursements tagged{' '}
            <strong className="text-ink-2">↪ Rebillable</strong> on this
            project that haven&apos;t been forwarded yet. Untick anything you
            don&apos;t want on this invoice. Net amounts go onto the invoice;
            GST recalculates at the invoice level.
          </p>
          <ul className="space-y-1">
            {rebillableCosts.map((c) => {
              const key = `${c.kind}:${c.id}`;
              const fieldName =
                c.kind === 'bill' ? 'rebillableBillIds' : 'rebillableExpenseIds';
              const checked = selectedCosts[key] ?? false;
              return (
                <li key={key}>
                  <label className="flex items-start gap-2 rounded-md border border-line bg-card px-2 py-1.5 text-xs hover:bg-surface-hover">
                    <input
                      type="checkbox"
                      name={fieldName}
                      value={c.id}
                      checked={checked}
                      onChange={(e) =>
                        setSelectedCosts((prev) => ({
                          ...prev,
                          [key]: e.target.checked,
                        }))
                      }
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${
                            c.kind === 'bill'
                              ? 'bg-status-amber-soft text-status-amber'
                              : 'bg-status-blue-soft text-status-blue'
                          }`}
                        >
                          {c.kind}
                        </span>
                        <span className="truncate text-ink">{c.label}</span>
                      </div>
                      <div className="text-[10px] text-ink-3">
                        {c.date.toLocaleDateString('en-AU')} · {c.category}
                      </div>
                    </div>
                    <div className="text-right tabular-nums">
                      <div className="text-ink">{formatMoney(c.amountExGstCents)}</div>
                      <div className="text-[10px] text-ink-3">ex GST</div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-status-amber/30 pt-2 text-xs">
            <span className="text-ink-3">Pass-through subtotal</span>
            <span className="font-semibold tabular-nums text-status-amber">
              {formatMoney(selectedCostsTotal)} ex GST
            </span>
          </div>
        </fieldset>
      )}

      {(milestones.length > 0 || rebillableCosts.length > 0) && (
        <div className="flex items-center justify-between border-t border-line pt-2 text-sm">
          <span className="text-ink-3">Invoice total</span>
          <span className="font-semibold tabular-nums text-ink">
            {formatMoney(grandTotal)} ex GST
          </span>
        </div>
      )}

      {state.status === 'error' && (
        <p className="text-sm text-status-red">{state.message}</p>
      )}
      <Submit disabled={submitDisabled} />
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
