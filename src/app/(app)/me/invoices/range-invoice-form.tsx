'use client';

import { useMemo, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { generateRangeContractorInvoice, type ConfirmInvoiceState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type RangeGroupView = {
  projectId: string;
  projectCode: string;
  projectName: string;
  hours: number;
  feesExGstCents: number;
  expenseTotalCents: number;
  expenseGstCents: number;
  expenseCount: number;
};

export type RangePendingView = {
  projectCode: string;
  projectName: string;
  hours: number;
  status: 'draft' | 'submitted';
  waitingOn: string[];
};

const money = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(
    cents / 100,
  );

const dollars = (cents: number) => (cents / 100).toFixed(2);

/**
 * The contractor composing their own invoice for a date range.
 *
 * Deliberately a FORM, not a receipt (D5, TT 2026-10-23). The month path
 * presents frozen figures to confirm, because a closed month's numbers are
 * what the approvals produced and must not drift. A range is different: the
 * contractor chose the window, so the window's figures are a starting point
 * and every field here is theirs to change — number, dates, the identifier
 * they reconcile against, and the fee on each line.
 *
 * Fee edits re-total live rather than on submit, because an invoice whose
 * total only appears after you commit it is not something anyone should be
 * asked to sign.
 */
export function RangeInvoiceForm({
  personId,
  start,
  end,
  groups,
  pending,
  excludedExpenseCount,
  suggestedNumber,
  defaultIssueDate,
  defaultDueDate,
  rateNote,
}: {
  personId: string;
  start: string;
  end: string;
  groups: RangeGroupView[];
  pending: RangePendingView[];
  excludedExpenseCount: number;
  suggestedNumber: string;
  defaultIssueDate: string;
  defaultDueDate: string;
  rateNote: { ratesCents: number[]; usedFrozenRate: boolean; usedCurrentRate: boolean };
}) {
  const [state, action] = useFormState<ConfirmInvoiceState, FormData>(
    generateRangeContractorInvoice,
    { status: 'idle' },
  );

  // Fee inputs are controlled so the totals below can move as they're typed.
  const [fees, setFees] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((g) => [g.projectId, dollars(g.feesExGstCents)])),
  );

  const totals = useMemo(() => {
    let feesExGst = 0;
    let feesGst = 0;
    let expenseTotal = 0;
    let expenseGst = 0;
    for (const g of groups) {
      const raw = fees[g.projectId] ?? '';
      // An unparseable or empty box contributes nothing rather than NaN —
      // the server rejects it on submit; the preview just shouldn't explode
      // mid-keystroke.
      const cents = /^\d{1,9}(\.\d{1,2})?$/.test(raw.trim())
        ? Math.round(Number(raw) * 100)
        : 0;
      feesExGst += cents;
      feesGst += Math.round(cents * 0.1);
      expenseTotal += g.expenseTotalCents;
      expenseGst += g.expenseGstCents;
    }
    return {
      feesExGst,
      feesGst,
      expenseTotal,
      expenseGst,
      // GST on fees is ADDED; GST within expenses is already inside the
      // pass-through figure and is never charged again (D3).
      gst: feesGst + expenseGst,
      total: feesExGst + feesGst + expenseTotal,
    };
  }, [fees, groups]);

  if (state.status === 'success') {
    return (
      <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
        {state.message}
      </div>
    );
  }

  const totalHours = groups.reduce((s, g) => s + g.hours, 0);
  const expenseCount = groups.reduce((s, g) => s + g.expenseCount, 0);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="end" value={end} />

      <div className="overflow-hidden rounded-md border border-line">
        <table className="w-full text-xs">
          <thead className="bg-surface-subtle text-ink-3">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Project</th>
              <th className="px-3 py-2 text-right font-medium">Hours</th>
              <th className="px-3 py-2 text-right font-medium">Expenses</th>
              <th className="px-3 py-2 text-right font-medium">Fee ex GST (A$)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {groups.map((g) => (
              <tr key={g.projectId}>
                <td className="px-3 py-2">
                  <span className="font-mono text-ink-3">{g.projectCode}</span>{' '}
                  <span className="text-ink-2">{g.projectName}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                  {g.hours.toFixed(2)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                  {g.expenseCount > 0 ? money(g.expenseTotalCents) : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  <Input
                    name={`fee:${g.projectId}`}
                    value={fees[g.projectId] ?? ''}
                    onChange={(e) =>
                      setFees((f) => ({ ...f, [g.projectId]: e.target.value }))
                    }
                    inputMode="decimal"
                    className="h-7 w-28 text-right font-mono text-xs"
                    aria-label={`Fee for ${g.projectCode} ex GST`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-surface-subtle">
            <tr className="text-ink">
              <td className="px-3 py-2 font-medium">
                Total · {totalHours.toFixed(2)}h
                {expenseCount > 0 &&
                  ` · ${expenseCount} ${expenseCount === 1 ? 'expense' : 'expenses'}`}
              </td>
              <td />
              <td className="px-3 py-2 text-right tabular-nums">
                {totals.expenseTotal > 0 ? money(totals.expenseTotal) : '—'}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {money(totals.feesExGst)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="rounded-md border border-line bg-surface-subtle p-3 text-xs">
        <div className="flex justify-between py-0.5">
          <span className="text-ink-3">Fees ex GST</span>
          <span className="tabular-nums text-ink">{money(totals.feesExGst)}</span>
        </div>
        {totals.expenseTotal > 0 && (
          <div className="flex justify-between py-0.5">
            <span className="text-ink-3">
              Expenses at cost
              <span className="ml-1 text-ink-4">
                (inc {money(totals.expenseGst)} GST)
              </span>
            </span>
            <span className="tabular-nums text-ink">{money(totals.expenseTotal)}</span>
          </div>
        )}
        <div className="flex justify-between py-0.5">
          <span className="text-ink-3">
            GST{totals.expenseTotal > 0 ? ' (10% on fees + GST within expenses)' : ' (10%)'}
          </span>
          <span className="tabular-nums text-ink">{money(totals.gst)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
          <span className="text-ink">Total inc GST</span>
          <span className="tabular-nums text-ink">{money(totals.total)}</span>
        </div>
        {rateNote.ratesCents.length > 0 && (
          <p className="mt-2 text-[11px] text-ink-3">
            {rateNote.ratesCents.length === 1
              ? `Priced at ${money(rateNote.ratesCents[0]!)}/h.`
              : `Priced at ${rateNote.ratesCents.map((r) => `${money(r)}/h`).join(' and ')} — ` +
                `a closed month keeps the rate it was approved at.`}{' '}
            Edit any line above if you have agreed something different.
          </p>
        )}
      </div>

      {pending.length > 0 && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft p-3 text-xs">
          <p className="font-medium text-status-amber">
            Not on this invoice — time in this range that isn&apos;t approved yet
          </p>
          <ul className="mt-1.5 space-y-1">
            {pending.map((p) => (
              <li key={`${p.projectCode}-${p.status}`} className="text-ink-2">
                <span className="font-mono text-ink-3">{p.projectCode}</span>{' '}
                <span className="tabular-nums">{p.hours.toFixed(2)}h</span>{' '}
                {p.status === 'draft' ? (
                  <>— still in draft, lodge it on your timesheet</>
                ) : (
                  <>— with {p.waitingOn.join(' / ')} for approval</>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-ink-3">
            Invoice the approved time now and raise a second invoice for the rest once
            it clears, or chase the approval and come back.
          </p>
        </div>
      )}

      {excludedExpenseCount > 0 && (
        <p className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-[11px] text-ink-3">
          {excludedExpenseCount} approved{' '}
          {excludedExpenseCount === 1 ? 'expense is' : 'expenses are'} not on this
          invoice because {excludedExpenseCount === 1 ? 'it has' : 'they have'} no
          project tagged. {excludedExpenseCount === 1 ? 'It stays' : 'They stay'} on the
          normal reimbursement path.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Your invoice number <span className="text-status-red">*</span>
          <Input
            name="contractorInvoiceNumber"
            required
            maxLength={80}
            defaultValue={suggestedNumber}
            className="h-8 font-mono text-xs"
          />
          <span className="text-[10px] text-ink-4">
            Suggested from your initials — change it to match your own numbering.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Issue date
          <Input
            name="issueDate"
            type="date"
            required
            defaultValue={defaultIssueDate}
            className="h-8 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Due date
          <Input
            name="dueDate"
            type="date"
            required
            defaultValue={defaultDueDate}
            className="h-8 text-xs"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-ink-3">
        Your reference (optional)
        <Input
          name="description"
          maxLength={500}
          placeholder="Your PO number, a client reference, whatever you reconcile against"
          className="h-8 text-xs"
        />
        <span className="text-[10px] text-ink-4">
          Shown on the bill in Foundry&apos;s AP queue and carried through to Xero.
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
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
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Notes for AP (optional)
          <Input name="notes" maxLength={1000} className="h-8 text-xs" />
        </label>
      </div>

      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}

      <div className="flex items-center gap-2">
        <SubmitButton count={groups.length} />
        <span className="text-[11px] text-ink-3">
          Raises one bill per project so each lands on the right engagement. Goes to
          Foundry&apos;s AP review.
        </span>
      </div>
    </form>
  );
}

function SubmitButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending
        ? 'Submitting…'
        : `Generate invoice (${count} ${count === 1 ? 'project' : 'projects'})`}
    </Button>
  );
}
