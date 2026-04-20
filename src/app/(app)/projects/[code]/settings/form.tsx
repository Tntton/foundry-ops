'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { updateProject, type ProjectEditState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const STAGES = ['kickoff', 'delivery', 'closing', 'archived'] as const;

type PersonOpt = { id: string; initials: string; firstName: string; lastName: string };

type ProjectSnapshot = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  stage: string;
  startDate: Date;
  endDate: Date;
  actualEndDate: Date | null;
  contractValue: number;
  primaryPartnerId: string;
  managerId: string;
};

export function ProjectSettingsForm({
  project,
  partners,
  managers,
}: {
  project: ProjectSnapshot;
  partners: PersonOpt[];
  managers: PersonOpt[];
}) {
  const bound = updateProject.bind(null, project.id);
  const [state, action] = useFormState<ProjectEditState, FormData>(bound, { status: 'idle' });
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

  return (
    <form action={action} className="space-y-6">
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}

      <Section title="Identity">
        <Field label="Code (read-only)">
          <Input defaultValue={project.code} disabled className="font-mono" />
        </Field>
        <Field label="Name" error={errs['name']}>
          <Input name="name" defaultValue={project.name} required />
        </Field>
        <Field label="Description" error={errs['description']}>
          <textarea
            name="description"
            rows={3}
            defaultValue={project.description ?? ''}
            className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </Field>
      </Section>

      <Section title="Lifecycle">
        <FieldRow>
          <Field label="Stage" error={errs['stage']}>
            <Select name="stage" defaultValue={project.stage}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start date" error={errs['startDate']}>
            <Input
              name="startDate"
              type="date"
              required
              defaultValue={project.startDate.toISOString().slice(0, 10)}
            />
          </Field>
          <Field label="End date (planned)" error={errs['endDate']}>
            <Input
              name="endDate"
              type="date"
              required
              defaultValue={project.endDate.toISOString().slice(0, 10)}
            />
          </Field>
        </FieldRow>
        <Field
          label="Actual end date (optional)"
          hint="Set when the project actually ended; leave blank otherwise"
          error={errs['actualEndDate']}
        >
          <Input
            name="actualEndDate"
            type="date"
            defaultValue={project.actualEndDate ? project.actualEndDate.toISOString().slice(0, 10) : ''}
            className="max-w-[220px]"
          />
        </Field>
      </Section>

      <Section title="Commercials">
        <Field label="Contract value (AUD, ex GST)" error={errs['contractValueDollars']}>
          <Input
            name="contractValueDollars"
            type="number"
            min="0"
            step="1"
            required
            defaultValue={String(project.contractValue / 100)}
            className="max-w-[220px]"
          />
        </Field>
      </Section>

      <Section title="Leadership">
        <FieldRow>
          <Field label="Primary partner" error={errs['primaryPartnerId']}>
            <Select name="primaryPartnerId" defaultValue={project.primaryPartnerId}>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.initials} · {p.firstName} {p.lastName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Project manager" error={errs['managerId']}>
            <Select name="managerId" defaultValue={project.managerId}>
              {managers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.initials} · {p.firstName} {p.lastName}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" asChild variant="ghost">
          <a href={`/projects/${project.code}`}>Cancel</a>
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
      {pending ? 'Saving…' : 'Save settings'}
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
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-ink-3">
        {label}
        {hint && <span className="ml-2 text-ink-4">· {hint}</span>}
      </label>
      {children}
      {error && <p className="text-xs text-status-red">{error}</p>}
    </div>
  );
}

function Select({
  name,
  defaultValue,
  children,
}: {
  name: string;
  defaultValue: string;
  children: React.ReactNode;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {children}
    </select>
  );
}
