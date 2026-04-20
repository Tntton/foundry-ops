'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { submitExpense, type NewExpenseState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const CATEGORIES = [
  { v: 'travel', label: 'Travel' },
  { v: 'meals', label: 'Meals' },
  { v: 'office', label: 'Office' },
  { v: 'tools', label: 'Tools / software' },
  { v: 'subscriptions', label: 'Subscriptions' },
  { v: 'other', label: 'Other' },
];

type ProjectOpt = { id: string; code: string; name: string };

export function NewExpenseForm({ projects }: { projects: ProjectOpt[] }) {
  const [state, action] = useFormState<NewExpenseState, FormData>(submitExpense, {
    status: 'idle',
  });
  const [amount, setAmount] = useState('0.00');
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

  const today = new Date().toISOString().slice(0, 10);
  const autoGst = (Number(amount) / 11).toFixed(2);

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
            <Input name="date" type="date" required defaultValue={today} />
          </Field>
          <Field label="Category" error={errs['category']} required>
            <Select name="category" required defaultValue="travel">
              {CATEGORIES.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project (optional)" hint="Leave blank for OPEX" error={errs['projectId']}>
            <Select name="projectId">
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
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="max-w-[180px]"
            />
          </Field>
          <Field
            label="GST (AUD)"
            error={errs['gstDollars']}
            hint="Auto-calc = total ÷ 11; override if needed"
            required
          >
            <Input
              name="gstDollars"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={autoGst}
              key={autoGst /* reset when total changes */}
              className="max-w-[180px]"
            />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Optional">
        <FieldRow>
          <Field label="Vendor" error={errs['vendor']}>
            <Input name="vendor" placeholder="Qantas, Uber, Officeworks…" />
          </Field>
        </FieldRow>
        <Field label="Description" error={errs['description']}>
          <textarea
            name="description"
            rows={3}
            className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Client meeting, flight to Melbourne, etc."
          />
        </Field>
      </Section>

      <div className="rounded-md border border-line bg-surface-subtle p-3 text-xs text-ink-3">
        Receipts and the Receipt Parser agent land with TASK-090. Attach via SharePoint link
        manually for now.
      </div>

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
