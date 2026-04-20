'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { createBill, type NewBillState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const CATEGORIES = [
  { v: 'subscriptions', label: 'Subscriptions' },
  { v: 'hosting', label: 'Hosting / cloud' },
  { v: 'office', label: 'Office' },
  { v: 'professional_services', label: 'Professional services' },
  { v: 'contractor_payment', label: 'Contractor payment' },
  { v: 'travel', label: 'Travel' },
  { v: 'other', label: 'Other' },
];

type ProjectOpt = { id: string; code: string; name: string };
type PersonOpt = { id: string; initials: string; firstName: string; lastName: string };

export function NewBillForm({
  projects,
  contractors,
}: {
  projects: ProjectOpt[];
  contractors: PersonOpt[];
}) {
  const [state, action] = useFormState<NewBillState, FormData>(createBill, { status: 'idle' });
  const [amount, setAmount] = useState('0.00');
  const autoGst = (Number(amount) / 11 || 0).toFixed(2);
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

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

      <Section title="Supplier">
        <FieldRow>
          <Field label="Supplier name" required>
            <Input name="supplierName" required placeholder="Vercel Inc., Linear B.V., …" />
          </Field>
          <Field
            label="Supplier invoice number"
            hint="Their ref on the bill, not yours"
          >
            <Input name="supplierInvoiceNumber" placeholder="INV-12345" />
          </Field>
        </FieldRow>
        <Field label="Contractor (optional)" hint="If supplier is a Person on payroll/AP">
          <select
            name="supplierPersonId"
            className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            <option value="">— External organisation —</option>
            {contractors.map((p) => (
              <option key={p.id} value={p.id}>
                {p.initials} · {p.firstName} {p.lastName}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Amount + classification">
        <FieldRow>
          <Field label="Issue date" required>
            <Input name="issueDate" type="date" required defaultValue={today} />
          </Field>
          <Field label="Due date" required>
            <Input name="dueDate" type="date" required defaultValue={in30} />
          </Field>
          <Field label="Category" required>
            <select
              name="category"
              required
              defaultValue="subscriptions"
              className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
            >
              {CATEGORIES.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Total (AUD, inc GST)" required>
            <Input
              name="amountDollars"
              type="number"
              min="0.01"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="max-w-[200px]"
            />
          </Field>
          <Field label="GST (auto ÷ 11, overridable)" required>
            <Input
              name="gstDollars"
              type="number"
              min="0"
              step="0.01"
              required
              defaultValue={autoGst}
              key={autoGst}
              className="max-w-[200px]"
            />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Project (optional)" hint="OPEX if blank">
            <select
              name="projectId"
              className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
            >
              <option value="">— OPEX —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cost centre (optional)">
            <Input name="costCentre" placeholder="R&D / G&A / …" />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Attachment">
        <Field
          label="SharePoint URL (optional)"
          hint="Paste the file link after uploading to SharePoint; full upload UX lands with TASK-046b"
        >
          <Input name="attachmentSharepointUrl" type="url" placeholder="https://…" />
        </Field>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" asChild variant="ghost">
          <a href="/bills">Cancel</a>
        </Button>
        <ActionButton intent="draft" label="Save for review" variant="outline" />
        <ActionButton intent="submit" label="Save + submit for approval" variant="default" />
      </div>
    </form>
  );
}

function ActionButton({
  intent,
  label,
  variant,
}: {
  intent: 'draft' | 'submit';
  label: string;
  variant: 'default' | 'outline';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="intent" value={intent} variant={variant} disabled={pending}>
      {pending ? '…' : label}
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
  required,
  children,
}: {
  label: string;
  hint?: string;
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
    </div>
  );
}
