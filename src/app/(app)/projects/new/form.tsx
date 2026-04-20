'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createProject, type NewProjectState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type PersonOpt = { id: string; initials: string; firstName: string; lastName: string };
type ClientOpt = { id: string; code: string; legalName: string };

export function NewProjectForm({
  clients,
  partners,
  managers,
}: {
  clients: ClientOpt[];
  partners: PersonOpt[];
  managers: PersonOpt[];
}) {
  const [state, action] = useFormState<NewProjectState, FormData>(createProject, {
    status: 'idle',
  });
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

  const today = new Date().toISOString().slice(0, 10);
  const inOneYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10);

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

      <Section title="Basics">
        <FieldRow>
          <Field label="Code" hint="e.g. IFM001, NIB042" error={errs['code']} required>
            <Input
              name="code"
              required
              maxLength={10}
              placeholder="IFM001"
              className="max-w-[200px] font-mono uppercase"
            />
          </Field>
          <Field label="Client" error={errs['clientId']} required>
            <Select name="clientId" required>
              <option value="">— Choose client —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.legalName}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
        <Field label="Name" error={errs['name']} required>
          <Input name="name" required placeholder="Market landscape diligence" />
        </Field>
        <Field label="Description" error={errs['description']} hint="Optional">
          <textarea
            name="description"
            rows={3}
            className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Scope, key questions, deliverables…"
          />
        </Field>
      </Section>

      <Section title="Commercials">
        <FieldRow>
          <Field label="Contract value (AUD, ex GST)" error={errs['contractValueDollars']} required>
            <Input
              name="contractValueDollars"
              type="number"
              min="0"
              max="10000000"
              step="1"
              required
              defaultValue="0"
              className="max-w-[200px]"
            />
          </Field>
          <Field label="Start date" error={errs['startDate']} required>
            <Input name="startDate" type="date" required defaultValue={today} />
          </Field>
          <Field label="End date" error={errs['endDate']} required>
            <Input name="endDate" type="date" required defaultValue={inOneYear} />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Team">
        <FieldRow>
          <Field label="Primary partner" error={errs['primaryPartnerId']} required>
            <Select name="primaryPartnerId" required>
              <option value="">— Choose partner —</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.initials} · {p.firstName} {p.lastName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project manager" error={errs['managerId']} required>
            <Select name="managerId" required>
              <option value="">— Choose manager —</option>
              {managers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.initials} · {p.firstName} {p.lastName}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
        <p className="text-xs text-ink-3">
          Team allocations and milestones can be edited from the project detail page after
          create (TASK-035 / TASK-036).
        </p>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" asChild variant="ghost">
          <a href="/projects">Cancel</a>
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
      {pending ? 'Creating…' : 'Create project'}
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
