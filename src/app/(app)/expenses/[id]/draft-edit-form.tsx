'use client';

import { useState, useTransition } from 'react';
import { saveDraftExpense, type DraftExpenseState } from './draft-actions';
import { EXPENSE_CATEGORIES } from '@/lib/expense-categories';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Inline edit form for the owner's DRAFT expenses — where failed-OCR
 * receipts get fixed. Two actions: "Save draft" keeps polishing;
 * "Submit for approval" pushes into the queue.
 *
 * GST mirrors /expenses/new: auto-computes total ÷ 11 until manually
 * edited, then sticks.
 */
export function DraftEditForm({
  expenseId,
  initial,
}: {
  expenseId: string;
  initial: {
    dateIso: string;
    amountDollars: string;
    gstDollars: string;
    category: string;
    vendor: string;
    description: string;
  };
}) {
  const [amount, setAmount] = useState(initial.amountDollars);
  const [gst, setGst] = useState(initial.gstDollars);
  // Seeded GST counts as touched when non-zero — an OCR-extracted GST
  // shouldn't be silently recomputed the moment the amount is edited.
  const [gstTouched, setGstTouched] = useState(Number(initial.gstDollars) > 0);
  const [state, setState] = useState<DraftExpenseState>({ status: 'idle' });
  const [pending, startTransition] = useTransition();

  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};
  const gstValue = gstTouched
    ? gst
    : amount
      ? (Number(amount) / 11).toFixed(2)
      : '';

  function run(intent: 'save' | 'submit', form: HTMLFormElement) {
    const fd = new FormData(form);
    fd.set('intent', intent);
    fd.set('gstDollars', gstValue);
    startTransition(async () => {
      const result = await saveDraftExpense(expenseId, { status: 'idle' }, fd);
      setState(result);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run('submit', e.currentTarget);
      }}
      className="space-y-3 rounded-lg border border-status-amber bg-status-amber-soft/30 p-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-ink">Draft — check and submit</h3>
        <p className="text-[11px] text-ink-3">
          This expense hasn&apos;t been submitted yet (usually because the
          receipt couldn&apos;t be read automatically). Correct the fields,
          then submit for approval.
        </p>
      </div>

      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'saved' && (
        <p className="text-xs text-status-green">Draft saved.</p>
      )}
      {state.status === 'submitted' && (
        <p className="text-xs text-status-green">
          Submitted for approval — you can close this page.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-ink-3">
          <span>Date</span>
          <Input name="date" type="date" required defaultValue={initial.dateIso} />
          {errs['date'] && <p className="text-status-red">{errs['date']}</p>}
        </label>
        <label className="space-y-1 text-xs text-ink-3">
          <span>Total (AUD, inc GST)</span>
          <Input
            name="amountDollars"
            type="number"
            min="0.01"
            max="100000"
            step="0.01"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
          {errs['amountDollars'] && (
            <p className="text-status-red">{errs['amountDollars']}</p>
          )}
        </label>
        <label className="space-y-1 text-xs text-ink-3">
          <span>GST (AUD){gstTouched ? ' · manual' : ' · auto ÷ 11'}</span>
          <Input
            name="gstDollars"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            required
            value={gstValue}
            onChange={(e) => {
              setGst(e.target.value);
              setGstTouched(true);
            }}
            placeholder="0.00"
          />
          {errs['gstDollars'] && (
            <p className="text-status-red">{errs['gstDollars']}</p>
          )}
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs text-ink-3">
          <span>Category</span>
          <select
            name="category"
            required
            defaultValue={initial.category}
            className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {errs['category'] && <p className="text-status-red">{errs['category']}</p>}
        </label>
        <label className="space-y-1 text-xs text-ink-3">
          <span>Vendor</span>
          <Input
            name="vendor"
            defaultValue={initial.vendor}
            placeholder="Qantas, Uber, Officeworks…"
          />
        </label>
        <label className="space-y-1 text-xs text-ink-3">
          <span>Description</span>
          <Input name="description" defaultValue={initial.description} />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={(e) => run('save', e.currentTarget.form!)}
        >
          {pending ? 'Saving…' : 'Save draft'}
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Submitting…' : 'Submit for approval'}
        </Button>
      </div>
    </form>
  );
}
