'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { createPayRun, type NewPayRunState } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const TYPES = [
  { v: 'contractor_ap', label: 'Contractor AP' },
  { v: 'supplier_ap', label: 'Supplier AP' },
  { v: 'mixed', label: 'Mixed AP' },
  { v: 'payroll', label: 'Payroll' },
  { v: 'super', label: 'Super' },
] as const;

export type BillOption = {
  id: string;
  supplierName: string;
  supplierInvoiceNumber: string | null;
  amountTotalCents: number;
  dueDate: Date;
  category: string;
  hasBankDetails: boolean;
  supplierPersonId: string | null;
};

export function NewPayRunForm({ bills }: { bills: BillOption[] }) {
  const [state, action] = useFormState<NewPayRunState, FormData>(createPayRun, {
    status: 'idle',
  });
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectEligible() {
    setSelected(new Set(bills.filter((b) => b.hasBankDetails).map((b) => b.id)));
  }
  function clearAll() {
    setSelected(new Set());
  }

  const selectedBills = bills.filter((b) => selected.has(b.id));
  const total = selectedBills.reduce((s, b) => s + b.amountTotalCents, 0);
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  )
    .toISOString()
    .slice(0, 10);

  return (
    <form action={action} className="space-y-6">
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}

      <p className="text-xs text-ink-3">
        Fields marked with <span className="text-status-red">*</span> are required.
      </p>

      <section className="space-y-3 rounded-lg border border-line bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">Basics</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Type" error={errs['type']} required>
            <select
              name="type"
              required
              defaultValue="contractor_ap"
              className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
            >
              {TYPES.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Period start" error={errs['periodStart']} required>
            <Input
              name="periodStart"
              type="date"
              required
              defaultValue={firstOfMonth}
            />
          </Field>
          <Field label="Period end" error={errs['periodEnd']} required>
            <Input name="periodEnd" type="date" required defaultValue={today} />
          </Field>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-line bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            Include bills ({selected.size} selected · {formatMoney(total)})
          </h2>
          <div className="flex gap-2">
            {bills.some((b) => b.hasBankDetails) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={selectEligible}
              >
                Select eligible
              </Button>
            )}
            {selected.size > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                Clear
              </Button>
            )}
          </div>
        </div>
        {bills.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">
            No approved bills to batch. Approve bills first, then come back here.
          </p>
        ) : (
          <ul className="space-y-1">
            {bills.map((b) => {
              const checked = selected.has(b.id);
              const eligible = b.hasBankDetails;
              return (
                <li
                  key={b.id}
                  className={`flex items-start gap-3 rounded-md border p-2 ${
                    checked ? 'border-brand bg-brand/5' : 'border-line'
                  } ${!eligible ? 'opacity-60' : ''}`}
                >
                  <input
                    type="checkbox"
                    name="billIds"
                    value={b.id}
                    checked={checked}
                    disabled={!eligible}
                    onChange={() => toggle(b.id)}
                    className="mt-1 h-4 w-4"
                    aria-label={`Include ${b.supplierName}`}
                  />
                  <div className="flex-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{b.supplierName}</span>
                      {b.supplierInvoiceNumber && (
                        <span className="font-mono text-xs text-ink-3">
                          {b.supplierInvoiceNumber}
                        </span>
                      )}
                      <Badge variant="outline" className="capitalize text-xs">
                        {b.category.replace(/_/g, ' ')}
                      </Badge>
                      {!eligible && (
                        <Badge variant="amber" className="text-xs">
                          {b.supplierPersonId
                            ? 'No bank details on file'
                            : 'External org — bank details not stored'}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-ink-3">
                      Due {b.dueDate.toLocaleDateString('en-AU')}
                    </div>
                  </div>
                  <div className="text-right font-semibold tabular-nums text-ink">
                    {formatMoney(b.amountTotalCents)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" asChild variant="ghost">
          <a href="/payroll">Cancel</a>
        </Button>
        <SubmitButton disabled={selected.size === 0} />
      </div>
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? 'Creating…' : 'Create pay run'}
    </Button>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-ink-3">
        {label}
        {required && <span className="ml-1 text-status-red">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-status-red">{error}</p>}
    </div>
  );
}
