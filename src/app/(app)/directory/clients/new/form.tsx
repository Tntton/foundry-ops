'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createClient, type NewClientState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const PAYMENT_TERMS = ['net-14', 'net-30', 'net-45'] as const;

type PartnerOption = {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
};

export function NewClientForm({ partners }: { partners: PartnerOption[] }) {
  const [state, action] = useFormState<NewClientState, FormData>(createClient, {
    status: 'idle',
  });
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

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

      <Section title="Identity">
        <FieldRow>
          <Field label="Code" error={errs['code']} hint="Short uppercase ID, e.g. IFM, NIB, CHM" required>
            <Input
              name="code"
              required
              maxLength={10}
              className="font-mono uppercase max-w-[200px]"
            />
          </Field>
          <Field label="Legal name" error={errs['legalName']} required>
            <Input name="legalName" required />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Trading name" error={errs['tradingName']} hint="Optional">
            <Input name="tradingName" />
          </Field>
          <Field label="ABN" error={errs['abn']} hint="11 digits; spaces ok">
            <Input
              name="abn"
              placeholder="00 000 000 000"
              className="font-mono max-w-[200px]"
            />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Billing">
        <Field label="Billing address" error={errs['billingAddress']}>
          <Input name="billingAddress" placeholder="Street, suburb, state, postcode" />
        </Field>
        <FieldRow>
          <Field label="Billing email" error={errs['billingEmail']}>
            <Input name="billingEmail" type="email" placeholder="ap@…" />
          </Field>
          <Field label="Payment terms" error={errs['paymentTerms']} required>
            <select
              name="paymentTerms"
              required
              defaultValue="net-30"
              className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {PAYMENT_TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
        </FieldRow>
      </Section>

      <Section title="Relationship">
        <Field label="Primary partner" error={errs['primaryPartnerId']} required>
          <select
            name="primaryPartnerId"
            required
            className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">— Choose partner —</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.initials} · {p.firstName} {p.lastName}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" asChild variant="ghost">
          <a href="/directory/clients">Cancel</a>
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
      {pending ? 'Creating…' : 'Create client'}
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
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{children}</div>;
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
