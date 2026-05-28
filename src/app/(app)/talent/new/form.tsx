'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createRecruit, type NewRecruitState } from '../actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type OwnerOpt = { id: string; firstName: string; lastName: string; band: string | null };
type ReferrerOpt = { id: string; firstName: string; lastName: string };

const TARGET_BAND_OPTIONS = [
  { value: 'senior_leader', label: 'Senior Leader (Partner / AP / MP tier)' },
  { value: 'expert', label: 'Expert' },
  { value: 'fellow', label: 'Fellow' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'analyst', label: 'Analyst' },
] as const;

const STAGE_HINTS = [
  'lead',
  'screening',
  'interviewing',
  'offer',
  'accepted',
] as const;

export function NewRecruitForm({
  owners,
  referrers,
  defaultOwnerId,
}: {
  owners: OwnerOpt[];
  referrers: ReferrerOpt[];
  defaultOwnerId: string;
}) {
  const [state, action] = useFormState<NewRecruitState, FormData>(
    createRecruit,
    { status: 'idle' },
  );
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

  return (
    <form action={action} className="space-y-6">
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}

      <Section title="Identity">
        <FieldRow>
          <Field label="First name" error={errs['firstName']} required>
            <Input name="firstName" required maxLength={100} />
          </Field>
          <Field label="Last name" error={errs['lastName']} required>
            <Input name="lastName" required maxLength={100} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Email" error={errs['email']} hint="Optional · personal email is fine">
            <Input name="email" type="email" maxLength={120} />
          </Field>
          <Field label="Phone" hint="Optional">
            <Input name="phone" type="tel" maxLength={40} />
          </Field>
          <Field label="Location" hint="City / region — optional">
            <Input name="location" maxLength={120} placeholder="e.g. Sydney" />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Pipeline">
        <FieldRow>
          <Field label="Target band" required error={errs['targetBand']}>
            <Select name="targetBand" required>
              <option value="">— Choose pool —</option>
              {TARGET_BAND_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Stage"
            hint="Optional — free-form (e.g. interviewing, offer)"
          >
            <Input
              name="stage"
              list="stage-options"
              placeholder="e.g. interviewing"
              maxLength={60}
            />
            <datalist id="stage-options">
              {STAGE_HINTS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Owner" required hint="Who's driving this conversation?">
            <Select name="ownerId" required defaultValue={defaultOwnerId}>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.firstName} {o.lastName}
                  {o.band ? ` (${o.band.replace(/_/g, ' ')})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Referred by" hint="Optional — who introduced them?">
            <Select name="referredById" defaultValue="">
              <option value="">— No one / direct application —</option>
              {referrers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Source" hint="LinkedIn, applied, conference, …">
            <Input name="source" maxLength={200} placeholder="e.g. LinkedIn" />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Links & notes">
        <FieldRow>
          <Field label="LinkedIn URL" error={errs['linkedinUrl']}>
            <Input
              name="linkedinUrl"
              type="url"
              maxLength={300}
              placeholder="https://linkedin.com/in/…"
            />
          </Field>
          <Field
            label="CV (SharePoint URL)"
            hint="Paste the SharePoint link after uploading"
            error={errs['cvSharepointUrl']}
          >
            <Input
              name="cvSharepointUrl"
              type="url"
              maxLength={500}
              placeholder="https://…sharepoint.com/…"
            />
          </Field>
        </FieldRow>
        <Field label="Notes" hint="Optional — private to the firm">
          <textarea
            name="notes"
            rows={4}
            maxLength={4000}
            placeholder="What stood out, who they've worked with, expected start date…"
            className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </Field>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" asChild variant="ghost">
          <a href="/talent">Cancel</a>
        </Button>
        <Submit />
      </div>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Adding…' : 'Add to pipeline'}
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
