'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import {
  createInvoiceFromTimesheets,
  type DraftFromTimeState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RebillableCost } from '@/server/invoice-drafter';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function DraftInvoiceFromTimeForm({
  projectId,
  defaultStart,
  defaultEnd,
  disabled,
  rebillableCosts,
}: {
  projectId: string;
  defaultStart: string;
  defaultEnd: string;
  disabled: boolean;
  rebillableCosts: RebillableCost[];
}) {
  const [state, action] = useFormState<DraftFromTimeState, FormData>(
    createInvoiceFromTimesheets,
    { status: 'idle' },
  );

  // Default-checked: every cost is included unless the user opts out.
  // The contract default already drove `rebillable=true`; surfacing them
  // pre-checked makes the common case one click ("Create draft invoice").
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rebillableCosts.map((c) => [`${c.kind}:${c.id}`, true])),
  );
  const selectedTotalExGst = rebillableCosts
    .filter((c) => selected[`${c.kind}:${c.id}`])
    .reduce((s, c) => s + c.amountExGstCents, 0);

  function toggleAll(value: boolean) {
    setSelected(
      Object.fromEntries(
        rebillableCosts.map((c) => [`${c.kind}:${c.id}`, value]),
      ),
    );
  }

  const submitDisabled =
    disabled && !rebillableCosts.some((c) => selected[`${c.kind}:${c.id}`]);

  return (
    <form action={action} className="space-y-4">
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
          <div className="flex items-center justify-between text-[11px]">
            <button
              type="button"
              onClick={() => toggleAll(true)}
              className="text-brand hover:underline"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => toggleAll(false)}
              className="text-ink-3 hover:text-ink-2 hover:underline"
            >
              Clear
            </button>
          </div>
          <ul className="space-y-1">
            {rebillableCosts.map((c) => {
              const key = `${c.kind}:${c.id}`;
              const fieldName =
                c.kind === 'bill' ? 'rebillableBillIds' : 'rebillableExpenseIds';
              const checked = selected[key] ?? false;
              return (
                <li key={key}>
                  <label className="flex items-start gap-2 rounded-md border border-line bg-card px-2 py-1.5 text-xs hover:bg-surface-hover">
                    <input
                      type="checkbox"
                      name={fieldName}
                      value={c.id}
                      checked={checked}
                      onChange={(e) =>
                        setSelected((prev) => ({
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
              {formatMoney(selectedTotalExGst)} ex GST
            </span>
          </div>
        </fieldset>
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
