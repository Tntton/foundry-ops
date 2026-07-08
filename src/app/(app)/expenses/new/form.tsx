'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { submitExpense, type NewExpenseState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EXPENSE_CATEGORIES } from '@/lib/expense-categories';

const CATEGORIES = EXPENSE_CATEGORIES.map((c) => ({
  v: c.value,
  label: c.label,
  hint: c.hint,
}));

type ProjectOpt = { id: string; code: string; name: string };

export type ExpenseFormInitialValues = {
  date?: string;
  category?: string;
  projectId?: string | null;
  amountDollars?: string;
  gstDollars?: string;
  vendor?: string;
  description?: string;
};

export function NewExpenseForm({
  projects,
  initialValues,
}: {
  projects: ProjectOpt[];
  initialValues?: ExpenseFormInitialValues;
}) {
  const [state, action] = useFormState<NewExpenseState, FormData>(submitExpense, {
    status: 'idle',
  });
  // Amount starts blank (placeholder shows the format) — a literal
  // "0.00" had to be selected and deleted before typing.
  const [amount, setAmount] = useState(initialValues?.amountDollars ?? '');
  // GST is controlled with a touched flag: auto-recomputes (total ÷ 11)
  // only until the user edits it manually. The previous key-remount
  // hack silently reverted a manual GST correction (e.g. GST-free
  // airfare component) the moment the total changed.
  const [gst, setGst] = useState(initialValues?.gstDollars ?? '');
  const [gstTouched, setGstTouched] = useState(Boolean(initialValues?.gstDollars));
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

  const today = new Date().toISOString().slice(0, 10);
  const gstValue = gstTouched
    ? gst
    : amount
      ? (Number(amount) / 11).toFixed(2)
      : '';

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

      <Section title="Details">
        <FieldRow>
          <Field label="Date" error={errs['date']} required>
            <Input
              name="date"
              type="date"
              required
              defaultValue={initialValues?.date ?? today}
            />
          </Field>
          <Field
            label="Category"
            error={errs['category']}
            required
            hint="Maps to a Xero account; ATO deductibility groups baked in."
          >
            <Select
              name="category"
              required
              defaultValue={initialValues?.category ?? 'travel'}
            >
              {CATEGORIES.map((c) => (
                <option key={c.v} value={c.v} title={c.hint}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project (optional)" hint="Leave blank for OPEX" error={errs['projectId']}>
            <Select name="projectId" defaultValue={initialValues?.projectId ?? ''}>
              <option value="">— OPEX —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
      </Section>

      <Section title="Amount">
        <FieldRow>
          <Field label="Total (AUD, inc GST)" error={errs['amountDollars']} required>
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
              className="max-w-[180px]"
            />
          </Field>
          <Field
            label="GST (AUD)"
            error={errs['gstDollars']}
            hint={
              gstTouched
                ? 'Manual — no longer auto-calculated'
                : 'Auto-calc = total ÷ 11; edit to override'
            }
            required
          >
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
              className="max-w-[180px]"
            />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Optional">
        <FieldRow>
          <Field label="Vendor" error={errs['vendor']}>
            <Input
              name="vendor"
              placeholder="Qantas, Uber, Officeworks…"
              defaultValue={initialValues?.vendor ?? ''}
            />
          </Field>
        </FieldRow>
        <Field label="Description" error={errs['description']}>
          <textarea
            name="description"
            rows={3}
            className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Client meeting, flight to Melbourne, etc."
            defaultValue={initialValues?.description ?? ''}
          />
        </Field>
        <Field
          label="Receipt (PDF / JPG / PNG)"
          error={errs['receipt']}
          hint="Filed automatically to the corporate FY archive in SharePoint; approvers see it inline. Optional but strongly recommended for audit."
        >
          <input
            name="receipt"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
            className="block w-full text-sm text-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-elev file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink-2 hover:file:bg-surface-subtle"
          />
        </Field>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" asChild variant="ghost">
          <a href="/expenses">Cancel</a>
        </Button>
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Submitting…' : 'Submit for approval'}
    </Button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-card p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h2>
      {children}
    </section>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{children}</div>;
}

function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-ink-3">
        {label}
        {required && <span className="ml-1 text-status-red">*</span>}
        {hint && <span className="ml-2 text-ink-4">· {hint}</span>}
      </label>
      {children}
      {error && <p className="text-xs text-status-red">{error}</p>}
    </div>
  );
}

function Select({
  name,
  required,
  defaultValue,
  children,
}: {
  name: string;
  required?: boolean;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <select
      name={name}
      required={required}
      defaultValue={defaultValue}
      className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {children}
    </select>
  );
}
