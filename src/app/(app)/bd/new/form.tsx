'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { createDeal, type NewDealState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ClientOpt = { id: string; code: string; legalName: string };
type PartnerOpt = { id: string; initials: string; firstName: string; lastName: string };

const STAGES = [
  { v: 'lead', label: 'Lead' },
  { v: 'qualifying', label: 'Qualifying' },
  { v: 'proposal', label: 'Proposal' },
  { v: 'negotiation', label: 'Negotiation' },
  { v: 'won', label: 'Won' },
  { v: 'lost', label: 'Lost' },
] as const;

export function NewDealForm({
  clients,
  owners,
}: {
  clients: ClientOpt[];
  owners: PartnerOpt[];
}) {
  const [state, action] = useFormState<NewDealState, FormData>(createDeal, {
    status: 'idle',
  });
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};
  const [useExisting, setUseExisting] = useState(true);
  const today = new Date();
  const defaultClose = new Date(today.getFullYear(), today.getMonth() + 3, today.getDate())
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

      <Section title="Deal">
        <FieldRow>
          <Field label="Code" hint="Short uppercase ID, e.g. BD-ACME-Q3" error={errs['code']} required>
            <Input
              name="code"
              required
              maxLength={15}
              className="font-mono uppercase max-w-[260px]"
              placeholder="BD-ACME-Q3"
            />
          </Field>
          <Field label="Deal name" error={errs['name']} required>
            <Input name="name" required placeholder="Digital health strategy engagement" />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Counterparty">
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="counterpartyMode"
              value="existing"
              checked={useExisting}
              onChange={() => setUseExisting(true)}
            />
            <span>Existing client</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="counterpartyMode"
              value="prospective"
              checked={!useExisting}
              onChange={() => setUseExisting(false)}
            />
            <span>Prospective org</span>
          </label>
        </div>
        {useExisting ? (
          <Field label="Client" error={errs['clientId']} required>
            <select
              name="clientId"
              required
              className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
            >
              <option value="">— Choose client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.legalName}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field
            label="Prospective name"
            hint="Will convert to a real client when the deal is won"
            error={errs['prospectiveName']}
            required
          >
            <Input name="prospectiveName" required placeholder="Acme Health Pty Ltd" />
          </Field>
        )}
      </Section>

      <Section title="Commercials">
        <FieldRow>
          <Field
            label="Expected value (AUD, ex GST)"
            error={errs['expectedValueDollars']}
            required
          >
            <Input
              name="expectedValueDollars"
              type="number"
              min="0"
              max="100000000"
              step="1"
              required
              defaultValue="0"
              className="max-w-[220px]"
            />
          </Field>
          <Field label="Probability (%)" error={errs['probability']} required>
            <Input
              name="probability"
              type="number"
              min="0"
              max="100"
              step="5"
              required
              defaultValue="25"
              className="max-w-[140px]"
            />
          </Field>
          <Field label="Target close" error={errs['targetCloseDate']}>
            <Input name="targetCloseDate" type="date" defaultValue={defaultClose} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Stage" error={errs['stage']} required>
            <select
              name="stage"
              defaultValue="lead"
              required
              className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
            >
              {STAGES.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Owner" error={errs['ownerId']} required>
            <select
              name="ownerId"
              required
              className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
            >
              <option value="">— Choose owner —</option>
              {owners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.initials} · {p.firstName} {p.lastName}
                </option>
              ))}
            </select>
          </Field>
        </FieldRow>
      </Section>

      <Section title="Notes">
        <Field label="Notes" error={errs['notes']}>
          <textarea
            name="notes"
            rows={4}
            className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink"
            placeholder="Key contacts, competitive landscape, what they care about…"
          />
        </Field>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" asChild variant="ghost">
          <a href="/bd">Cancel</a>
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
      {pending ? 'Creating…' : 'Create deal'}
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
