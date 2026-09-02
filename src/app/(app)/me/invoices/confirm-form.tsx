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
}: {
  personId: string;
  year: number;
  month: number;
  monthLabel: string;
  hours: number;
  rateCents: number;
  amountExGstCents: number;
}) {
  const [state, action] = useFormState<ConfirmInvoiceState, FormData>(
    confirmContractorInvoice,
    { status: 'idle' },
  );

  const gst = Math.round(amountExGstCents * 0.1);
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
        <div className="flex justify-between py-0.5">
          <span className="text-ink-3">GST (10%)</span>
          <span className="tabular-nums text-ink">{money(gst)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
          <span className="text-ink">Total inc GST</span>
          <span className="tabular-nums text-ink">{money(amountExGstCents + gst)}</span>
        </div>
        <p className="mt-2 text-[11px] text-ink-3">
          Rate locked when {monthLabel} was approved. Split across projects on submit so
          each lands on the right engagement.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Your invoice number <span className="text-status-red">*</span>
          <Input
            name="contractorInvoiceNumber"
            required
            maxLength={80}
            placeholder="e.g. JN-2026-08"
            className="h-8 font-mono text-xs"
          />
        </label>
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
