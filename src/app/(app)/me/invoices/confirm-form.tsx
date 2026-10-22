'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { confirmContractorInvoice, type ConfirmInvoiceState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * The moment the contractor issues their invoice.
 *
 * Foundry has pre-filled the figures, but this form is where the document
 * becomes theirs: their number, optionally their own PDF. That is the whole
 * substance of D1 — Foundry never issues on their behalf — so the number
 * field is required and labelled as theirs, not as a reference.
 */
export function ConfirmInvoiceForm({
  personId,
  year,
  month,
  monthLabel,
  hours,
  rateCents,
  amountExGstCents,
  expenseTotalCents,
  expenseGstCents,
  expenseCount,
  excludedExpenseCount,
  suggestedNumber,
  suggestedExpenseNumber,
}: {
  personId: string;
  year: number;
  month: number;
  monthLabel: string;
  hours: number;
  rateCents: number;
  amountExGstCents: number;
  /** Pass-through costs, GST-INCLUSIVE (D3). */
  expenseTotalCents: number;
  /** GST already inside expenseTotalCents; Foundry reclaims it. */
  expenseGstCents: number;
  expenseCount: number;
  /** Untagged (OPEX) expenses that stay on the reimbursement path. */
  excludedExpenseCount: number;
  suggestedNumber: string;
  suggestedExpenseNumber: string;
}) {
  const [state, action] = useFormState<ConfirmInvoiceState, FormData>(
    confirmContractorInvoice,
    { status: 'idle' },
  );

  // Both legs now carry the contractor's OWN GST. Fees: 10% on hours × rate.
  // Expenses: D8 (TT 2026-10-23) replaced the D4 pass-through with a
  // recharge — the contractor reclaims the GST they paid and bills Foundry
  // the net plus 10% of their own. On a GST-free cost there was nothing to
  // reclaim, so that 10% is a real increase on what they paid.
  const feesGst = Math.round(amountExGstCents * 0.1);
  const expensesExGst = expenseTotalCents - expenseGstCents;
  const expensesGstAdded = Math.round(expensesExGst * 0.1);
  const gst = feesGst + expensesGstAdded;
  const total = amountExGstCents + feesGst + expensesExGst + expensesGstAdded;
  const money = (cents: number) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(
      cents / 100,
    );

  if (state.status === 'success') {
    return (
      <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-xs text-status-green">
        {state.message}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />

      <div className="rounded-md border border-line bg-surface-subtle p-3 text-xs">
        <div className="flex justify-between py-0.5">
          <span className="text-ink-3">
            {hours.toFixed(1)}h @ {money(rateCents)}/h
          </span>
          <span className="tabular-nums text-ink">{money(amountExGstCents)}</span>
        </div>
        {expenseCount > 0 && (
          <div className="flex justify-between py-0.5">
            <span className="text-ink-3">
              Expenses recharged · {expenseCount} {expenseCount === 1 ? 'item' : 'items'}
              <span className="ml-1 text-ink-4">
                (you paid {money(expenseTotalCents)} inc GST and reclaim that
                GST yourself)
              </span>
            </span>
            <span className="tabular-nums text-ink">{money(expensesExGst)}</span>
          </div>
        )}
        <div className="flex justify-between py-0.5">
          <span className="text-ink-3">GST (10%)</span>
          <span className="tabular-nums text-ink">{money(gst)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
          <span className="text-ink">Total inc GST</span>
          <span className="tabular-nums text-ink">{money(total)}</span>
        </div>
        {excludedExpenseCount > 0 && (
          <div className="mt-2 rounded-md border border-line bg-surface-subtle px-2 py-1.5 text-[11px] text-ink-3">
            {excludedExpenseCount} approved{' '}
            {excludedExpenseCount === 1 ? 'expense is' : 'expenses are'} not on this
            invoice because {excludedExpenseCount === 1 ? 'it has' : 'they have'} no
            project tagged. {excludedExpenseCount === 1 ? 'It stays' : 'They stay'} on the
            normal reimbursement path — tag {excludedExpenseCount === 1 ? 'it' : 'them'} to
            a project before the month closes to include{' '}
            {excludedExpenseCount === 1 ? 'it' : 'them'} next time.
          </div>
        )}
        <p className="mt-2 text-[11px] text-ink-3">
          Rate locked when {monthLabel} was approved. Split across projects on submit so
          each lands on the right engagement.
        </p>
      </div>

      {expenseCount > 0 && (
        <p className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-[11px] text-ink-3">
          Your expenses go out as a <strong>separate invoice</strong> with its
          own number. You bill Foundry net of GST and add your own 10% on top;
          the GST on the receipt is yours to reclaim.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Your time invoice number <span className="text-status-red">*</span>
          <Input
            name="contractorInvoiceNumber"
            required
            maxLength={80}
            defaultValue={suggestedNumber}
            placeholder="e.g. JN-2026-08"
            className="h-8 font-mono text-xs"
          />
        </label>
        {expenseCount > 0 && (
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            Your expense invoice number <span className="text-status-red">*</span>
            <Input
              name="expenseInvoiceNumber"
              required
              maxLength={80}
              defaultValue={suggestedExpenseNumber}
              className="h-8 font-mono text-xs"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Your invoice PDF (optional)
          <Input
            name="attachmentSharepointUrl"
            type="url"
            maxLength={500}
            placeholder="SharePoint link"
            className="h-8 text-xs"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-ink-3">
        Notes (optional)
        <Input name="notes" maxLength={1000} className="h-8 text-xs" />
      </label>

      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton />
        <span className="text-[11px] text-ink-3">
          Goes to Foundry&apos;s AP review — you&apos;ll see the status here.
        </span>
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Submitting…' : 'Submit invoice'}
    </Button>
  );
}
