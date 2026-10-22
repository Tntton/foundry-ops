'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateExpense, deleteExpense, type ExpenseEditState } from './edit-actions';
import { EXPENSE_CATEGORIES } from '@/lib/expense-categories';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type ExpenseEditPanelProps = {
  expenseId: string;
  initial: {
    dateIso: string;
    amountDollars: string;
    gstDollars: string;
    category: string;
    vendor: string;
    /** Description with any sync reference already stripped. */
    description: string;
    projectId: string;
  };
  projectOptions: readonly { id: string; code: string; name: string }[];
  /** 'draft' offers "Submit for approval"; everything else is a plain save. */
  status: string;
  /** The viewer is reaching past their own pre-approval window — the
   *  reason field is mandatory and the panel says why. */
  overrideMode: boolean;
  /** True when a client invoice already carries this cost. */
  rebilledOnInvoice: boolean;
};

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring';

/**
 * TASK-516 — the one edit surface for an expense.
 *
 * Renders for the submitter while the row is still `draft` / `submitted`,
 * and for an admin in any state (reason required). The page decides
 * whether to render it at all; this component only has to render the mode
 * it is given.
 */
export function ExpenseEditPanel({
  expenseId,
  initial,
  projectOptions,
  status,
  overrideMode,
  rebilledOnInvoice,
}: ExpenseEditPanelProps) {
  const router = useRouter();
  const isDraft = status === 'draft';

  const [amount, setAmount] = useState(initial.amountDollars);
  const [gst, setGst] = useState(initial.gstDollars);
  // A GST the OCR already extracted counts as touched — editing the total
  // shouldn't silently recompute a figure that came off the receipt.
  const [gstTouched, setGstTouched] = useState(Number(initial.gstDollars) > 0);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<ExpenseEditState>({ status: 'idle' });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [pending, startTransition] = useTransition();

  const errs = state.status === 'error' ? (state.fieldErrors ?? {}) : {};
  const gstValue = gstTouched ? gst : amount ? (Number(amount) / 11).toFixed(2) : '';

  function save(intent: 'save' | 'submit', form: HTMLFormElement) {
    const fd = new FormData(form);
    fd.set('intent', intent);
    fd.set('gstDollars', gstValue);
    fd.set('reason', reason);
    startTransition(async () => {
      setState(await updateExpense(expenseId, { status: 'idle' }, fd));
      router.refresh();
    });
  }

  function remove() {
    const fd = new FormData();
    fd.set('reason', reason);
    fd.set('confirm', deleteConfirm.trim().toUpperCase());
    startTransition(async () => {
      const result = await deleteExpense(expenseId, { status: 'idle' }, fd);
      setState(result);
      if (result.status === 'deleted') router.push('/expenses');
    });
  }

  return (
    <div
      className={`space-y-3 rounded-lg border p-4 ${
        overrideMode
          ? 'border-status-red bg-status-red-soft/20'
          : isDraft
            ? 'border-status-amber bg-status-amber-soft/30'
            : 'border-line bg-surface-subtle/40'
      }`}
    >
      <div>
        <h3 className="text-sm font-semibold text-ink">
          {overrideMode
            ? 'Admin override — edit or delete'
            : isDraft
              ? 'Draft — check and submit'
              : 'Edit this expense'}
        </h3>
        <p className="text-[11px] text-ink-3">
          {overrideMode ? (
            <>
              This isn&apos;t yours to change, or it has already been decided.
              Give a reason — it goes in the audit trail with your name and the
              before/after values. Editing a decided expense sends it back for
              re-approval rather than amending a signed-off figure.
            </>
          ) : isDraft ? (
            <>
              This expense hasn&apos;t been submitted yet (usually because the
              receipt couldn&apos;t be read automatically). Correct the fields,
              then submit for approval.
            </>
          ) : (
            <>
              Fix anything the receipt scan got wrong. You can edit or delete
              this until it&apos;s approved — after that, an admin has to do it
              and the approval re-opens.
            </>
          )}
        </p>
      </div>

      {rebilledOnInvoice && (
        <p className="rounded-md border border-status-amber bg-status-amber-soft/40 p-2 text-[11px] text-ink-2">
          This cost has already been passed on to a client invoice. Changing the
          amount here will not change what the client was billed — fix the
          invoice too, or the two will disagree.
        </p>
      )}

      {state.status === 'error' && <p className="text-xs text-status-red">{state.message}</p>}
      {state.status === 'saved' && <p className="text-xs text-status-green">Saved.</p>}
      {state.status === 'submitted' && (
        <p className="text-xs text-status-green">Submitted for approval.</p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(isDraft ? 'submit' : 'save', e.currentTarget);
        }}
        className="space-y-3"
      >
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
            {errs['amountDollars'] && <p className="text-status-red">{errs['amountDollars']}</p>}
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
            {errs['gstDollars'] && <p className="text-status-red">{errs['gstDollars']}</p>}
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs text-ink-3">
            <span>Category</span>
            <select
              name="category"
              required
              defaultValue={initial.category}
              className={SELECT_CLASS}
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
            <span>Project</span>
            <select name="projectId" defaultValue={initial.projectId} className={SELECT_CLASS}>
              <option value="">OPEX — no project</option>
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
            {errs['projectId'] && <p className="text-status-red">{errs['projectId']}</p>}
          </label>
          <label className="space-y-1 text-xs text-ink-3">
            <span>Vendor</span>
            <Input
              name="vendor"
              defaultValue={initial.vendor}
              placeholder="Qantas, Uber, Officeworks…"
            />
          </label>
        </div>

        <label className="block space-y-1 text-xs text-ink-3">
          <span>Description</span>
          <Input name="description" defaultValue={initial.description} />
        </label>

        {overrideMode && (
          <label className="block space-y-1 text-xs text-ink-3">
            <span>Reason for the override (recorded in the audit trail)</span>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Rachael's receipt was scanned at the wrong amount — corrected from the PDF"
              maxLength={500}
            />
            {errs['reason'] && <p className="text-status-red">{errs['reason']}</p>}
          </label>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setConfirmingDelete((v) => !v);
              setState({ status: 'idle' });
            }}
            className="text-status-red hover:text-status-red"
          >
            {confirmingDelete ? 'Cancel delete' : 'Delete'}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {isDraft && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={(e) => save('save', e.currentTarget.form!)}
              >
                {pending ? 'Saving…' : 'Save draft'}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={pending}>
              {pending
                ? isDraft
                  ? 'Submitting…'
                  : 'Saving…'
                : isDraft
                  ? 'Submit for approval'
                  : 'Save changes'}
            </Button>
          </div>
        </div>
      </form>

      {confirmingDelete && (
        <div className="space-y-2 rounded-md border border-status-red bg-status-red-soft/20 p-3">
          <p className="text-xs text-ink-2">
            Deleting removes the expense and withdraws any approval waiting on
            it. The full before-image stays in the audit log. Type{' '}
            <span className="font-mono font-semibold">DELETE</span> to confirm.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-xs text-ink-3">
              <span>Confirm</span>
              <Input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder="DELETE"
                className="w-32"
              />
            </label>
            {overrideMode && (
              <label className="min-w-[14rem] flex-1 space-y-1 text-xs text-ink-3">
                <span>Reason</span>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why this is being deleted"
                  maxLength={500}
                />
              </label>
            )}
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={pending || deleteConfirm.trim().toUpperCase() !== 'DELETE'}
              onClick={remove}
            >
              {pending ? 'Deleting…' : 'Delete expense'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
