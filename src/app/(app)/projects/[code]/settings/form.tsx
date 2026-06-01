'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { updateProject, type ProjectEditState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const STAGES = ['kickoff', 'delivery', 'closing', 'archived'] as const;

const CURRENCIES = [
  { v: 'AUD', label: 'AUD — Australian dollar' },
  { v: 'NZD', label: 'NZD — New Zealand dollar' },
  { v: 'USD', label: 'USD — US dollar' },
  { v: 'GBP', label: 'GBP — British pound' },
  { v: 'EUR', label: 'EUR — Euro' },
  { v: 'SGD', label: 'SGD — Singapore dollar' },
] as const;

type PersonOpt = { id: string; initials: string; firstName: string; lastName: string };

export type ClientChoice = {
  id: string;
  code: string;
  legalName: string;
  /** Next available sequence number for this client (e.g. 5 means
   *  CAC005 if the client code is CAC). Pre-computed server-side. */
  nextNumber: number;
};

type ProjectSnapshot = {
  id: string;
  code: string;
  clientId: string;
  name: string;
  description: string | null;
  stage: string;
  startDate: Date | null;
  endDate: Date | null;
  actualEndDate: Date | null;
  contractValue: number;
  currency: string;
  primaryPartnerId: string;
  managerId: string;
  defaultExpensesRebillable: boolean;
};

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addWeeks(isoDate: string, weeks: number): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function weeksBetween(startIso: string, endIso: string): number {
  const a = new Date(startIso + 'T00:00:00Z').getTime();
  const b = new Date(endIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / (7 * 24 * 3600 * 1000));
}

export function ProjectSettingsForm({
  project,
  partners,
  managers,
  clientChoices,
}: {
  project: ProjectSnapshot;
  partners: PersonOpt[];
  managers: PersonOpt[];
  clientChoices: ClientChoice[];
}) {
  const bound = updateProject.bind(null, project.id);
  const [state, action] = useFormState<ProjectEditState, FormData>(bound, { status: 'idle' });
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

  // Code is now derived from client + sequence number. State tracks
  // the current client + number; the visible code preview updates as
  // either changes. Parse the project's existing code to seed both:
  //   "CAC001"  → CAC + 1
  //   "IFM001-2" (legacy with suffix) → IFM + 1, suffix dropped
  const initialClient =
    clientChoices.find((c) => c.id === project.clientId) ?? clientChoices[0];
  const parsedExisting = (() => {
    if (!initialClient) return { num: 1 };
    const m = project.code.match(new RegExp(`^${initialClient.code}(\\d+)`));
    return { num: m && m[1] ? parseInt(m[1], 10) : initialClient.nextNumber };
  })();
  const [clientId, setClientId] = useState<string>(initialClient?.id ?? '');
  const [projectNumber, setProjectNumber] = useState<number>(parsedExisting.num);
  const selectedClient = clientChoices.find((c) => c.id === clientId) ?? null;
  const previewCode = selectedClient
    ? `${selectedClient.code}${String(projectNumber).padStart(3, '0')}`
    : project.code;

  function onClientChange(newId: string) {
    setClientId(newId);
    const c = clientChoices.find((x) => x.id === newId);
    // Auto-bump to next number when switching to a different client
    if (c && c.id !== project.clientId) {
      setProjectNumber(c.nextNumber);
    } else if (c && c.id === project.clientId) {
      setProjectNumber(parsedExisting.num);
    }
  }

  const [startDate, setStartDate] = useState(
    project.startDate ? toIso(project.startDate) : '',
  );
  const [endDate, setEndDate] = useState(
    project.endDate ? toIso(project.endDate) : '',
  );
  const [durationWeeks, setDurationWeeks] = useState(() =>
    project.startDate && project.endDate
      ? Math.max(1, weeksBetween(toIso(project.startDate), toIso(project.endDate)))
      : 12,
  );
  const datesIncomplete = !startDate || !endDate;

  // Keep the three inputs in sync without fighting each other:
  //   - Change start: end stays anchored to current duration
  //   - Change end: duration updates
  //   - Change duration: end updates
  function onStartChange(next: string) {
    setStartDate(next);
    if (next) setEndDate(addWeeks(next, durationWeeks));
  }
  function onEndChange(next: string) {
    setEndDate(next);
    if (next && startDate) {
      const w = weeksBetween(startDate, next);
      if (w > 0) setDurationWeeks(w);
    }
  }
  function onDurationChange(nextWeeks: number) {
    if (!Number.isFinite(nextWeeks) || nextWeeks < 1) return;
    setDurationWeeks(nextWeeks);
    if (startDate) setEndDate(addWeeks(startDate, nextWeeks));
  }

  return (
    <form action={action} className="space-y-6">
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}

      <Section title="Identity">
        {/* Client picker + sequence number → code is derived. Admin
            renames a project by switching the client (auto-suggests
            next sequence) and tweaking the number. The resulting
            code is shown as read-only preview below. */}
        <Field
          label="Client"
          error={errs['clientId']}
          hint={
            clientChoices.length === 0
              ? 'No clients yet — create one under Directory → Clients first.'
              : 'Code prefix = client. Switching clients auto-suggests the next available number.'
          }
        >
          <select
            name="clientId"
            value={clientId}
            onChange={(e) => onClientChange(e.target.value)}
            required
            className="h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            {clientChoices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.legalName} (next: {c.code}
                {String(c.nextNumber).padStart(3, '0')})
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Project number"
          error={errs['projectNumber']}
          hint={
            selectedClient
              ? `Next available for ${selectedClient.code}: ${String(selectedClient.nextNumber).padStart(3, '0')}`
              : 'Pick a client first.'
          }
        >
          <Input
            name="projectNumber"
            type="number"
            min={1}
            max={9999}
            value={projectNumber}
            onChange={(e) => setProjectNumber(parseInt(e.target.value || '1', 10))}
            required
            className="font-mono"
          />
        </Field>
        <Field label="Code (preview)" hint="Generated from client code + number. Audited on save.">
          <Input
            value={previewCode}
            disabled
            className="font-mono"
          />
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
        <p className="-mt-1 text-xs text-ink-3">
          Start + end are <strong>theoretical</strong> — the plan, not a hard constraint.
          Timesheets and invoices can sit outside this window; stage + actual-end are the
          true lifecycle markers. Dates are optional at create-time but must be set
          before moving the project to <span className="font-mono">closing</span> or{' '}
          <span className="font-mono">archived</span>.
        </p>
        {datesIncomplete && (
          <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-xs text-status-amber">
            Reconcile reminder: theoretical start &amp; end aren&apos;t both set yet. You
            can save now, but the system will block stage transitions to closing /
            archived until both dates are filled in.
          </div>
        )}
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
          <Field label="Theoretical start" hint="Optional" error={errs['startDate']}>
            <Input
              name="startDate"
              type="date"
              value={startDate}
              onChange={(e) => onStartChange(e.target.value)}
            />
          </Field>
          <Field
            label="Duration"
            hint="Weeks from start"
            error={errs['endDate']}
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={520}
                step={1}
                value={durationWeeks}
                onChange={(e) => onDurationChange(parseInt(e.target.value, 10))}
                className="max-w-[120px] font-mono"
              />
              <span className="text-xs text-ink-3">weeks</span>
            </div>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Theoretical end" hint="Optional" error={errs['endDate']}>
            <Input
              name="endDate"
              type="date"
              value={endDate}
              onChange={(e) => onEndChange(e.target.value)}
            />
          </Field>
          <Field
            label="Actual end date"
            hint="When the project really wrapped; leave blank while active"
            error={errs['actualEndDate']}
          >
            <Input
              name="actualEndDate"
              type="date"
              defaultValue={
                project.actualEndDate
                  ? project.actualEndDate.toISOString().slice(0, 10)
                  : ''
              }
            />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Commercials">
        <FieldRow>
          <Field label="Currency" error={errs['currency']}>
            <Select name="currency" defaultValue={project.currency || 'AUD'}>
              {CURRENCIES.map((c) => (
                <option key={c.v} value={c.v}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Contract value (ex GST)"
            hint="Denominated in the currency above"
            error={errs['contractValueDollars']}
          >
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
        </FieldRow>
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

      <Section title="Billing terms">
        <p className="text-[11px] text-ink-3">
          Controls how expenses and supplier bills tagged to this project
          flow back to the client invoice. Reflects the engagement&apos;s
          contract type.
        </p>
        <label className="flex items-start gap-3 rounded-md border border-line bg-surface-elev px-3 py-2 text-sm">
          <input
            type="checkbox"
            name="defaultExpensesRebillable"
            value="1"
            defaultChecked={project.defaultExpensesRebillable}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-ink">
              Pass-through costs by default
            </span>
            <span className="block text-[11px] text-ink-3">
              When on, every new expense / bill tagged to this project starts
              with the <strong>↪ Rebillable</strong> flag set — the cost
              forwards to the next client invoice unless someone opts the
              line out. Use for time &amp; materials / cost-plus contracts.
              Leave off for fixed-fee where Foundry absorbs costs.
            </span>
          </span>
        </label>
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
