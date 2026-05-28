'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { createProject, type NewProjectState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type PersonOpt = { id: string; initials: string; firstName: string; lastName: string };
type ClientOpt = { id: string; code: string; legalName: string };

type Prefill = {
  clientId?: string;
  name?: string;
  description?: string;
  contractValueDollars?: number;
  primaryPartnerId?: string;
  dealId?: string;
};

export function NewProjectForm({
  clients,
  partners,
  managers,
  prefill,
  internalClient,
  nextFhpCode,
  initialKind = 'client',
}: {
  clients: ClientOpt[];
  partners: PersonOpt[];
  managers: PersonOpt[];
  prefill?: Prefill;
  /** The FH internal client row (`code: 'FH'`) — used to auto-pin
   *  internal projects without showing the client picker. Null when
   *  the seed hasn't run yet, in which case the internal branch is
   *  disabled. */
  internalClient: { id: string; legalName: string } | null;
  /** Server-suggested next free FHP code (e.g. "FHP007"). The form
   *  pre-fills the code field with this when the operator picks
   *  "Internal" so they don't have to remember the sequence. */
  nextFhpCode: string;
  /** Default kind — `client` everywhere except when the URL contains
   *  `?kind=internal` (e.g. from the projects-kanban "+ New internal
   *  project" affordance). */
  initialKind?: 'client' | 'internal';
}) {
  const [state, action] = useFormState<NewProjectState, FormData>(createProject, {
    status: 'idle',
  });
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

  // Kind picker is the very first decision the operator makes — it
  // drives whether the rest of the form asks for a client + contract
  // value or auto-pins to the FH internal client and treats the
  // commercials section as an optional internal budget instead.
  const [kind, setKind] = useState<'client' | 'internal'>(
    internalClient ? initialKind : 'client',
  );
  const isInternal = kind === 'internal';
  // When the operator flips to "Internal", swap the code placeholder
  // / value to the next FHP code. Switching back to "Client" clears
  // the code so they re-enter their own (e.g. IFM001).
  const [code, setCode] = useState<string>(
    isInternal ? nextFhpCode : '',
  );

  function handleKindChange(next: 'client' | 'internal') {
    setKind(next);
    setCode(next === 'internal' ? nextFhpCode : '');
  }

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

      {prefill?.dealId && <input type="hidden" name="fromDealId" value={prefill.dealId} />}

      {/* The kind is the first decision — Client engagement vs Internal
           FH initiative. Server reads `kind` and either validates the
           full client+contract form or skips client + contract value
           and auto-pins the FH internal client. */}
      <input type="hidden" name="kind" value={kind} />
      <Section title="Project type">
        <p className="-mt-1 text-xs text-ink-3">
          Pick the type before filling out the rest. Client engagements
          carry a contract + dates + P&amp;L; internal FH projects (FHP
          series — primer dev, social, brand) skip those and track
          against an internal budget only.
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <KindOption
            checked={kind === 'client'}
            onChange={() => handleKindChange('client')}
            label="Client engagement"
            description="Paying client, contract value, P&L surface, invoices."
          />
          <KindOption
            checked={kind === 'internal'}
            onChange={() => handleKindChange('internal')}
            disabled={!internalClient}
            label="Internal FH project (FHP series)"
            description={
              internalClient
                ? 'No client revenue. Track against an internal budget. ' +
                  'Standing or episodic — start/end dates optional.'
                : 'Run scripts/seed-house-projects.ts to create the FH internal client first.'
            }
          />
        </div>
      </Section>

      <Section title="Basics">
        <FieldRow>
          <Field
            label="Code"
            hint={
              isInternal
                ? `Next free internal code: ${nextFhpCode}`
                : 'e.g. IFM001, NIB042'
            }
            error={errs['code']}
            required
          >
            <Input
              name="code"
              required
              maxLength={10}
              placeholder={isInternal ? nextFhpCode : 'IFM001'}
              className="max-w-[200px] font-mono uppercase"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </Field>
          {isInternal ? (
            <Field
              label="Client"
              hint="Auto-pinned to FH internal — no picker needed."
            >
              <div className="flex h-9 items-center rounded-md border border-line bg-surface-subtle px-2 text-sm text-ink-2">
                <span className="font-mono text-xs text-ink-3">FH</span>
                <span className="ml-2">
                  {internalClient?.legalName ?? 'Foundry Health (internal)'}
                </span>
              </div>
              {internalClient && (
                <input
                  type="hidden"
                  name="clientId"
                  value={internalClient.id}
                />
              )}
            </Field>
          ) : (
            <Field
              label="Client"
              error={errs['clientId']}
              required
              hint="Or "
            >
              <div className="flex items-center gap-2">
                <Select
                  name="clientId"
                  required
                  {...(prefill?.clientId ? { defaultValue: prefill.clientId } : {})}
                >
                  <option value="">— Choose client —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.legalName}
                    </option>
                  ))}
                </Select>
                <a
                  href="/directory/clients/new?createProjectAfter=1"
                  className="shrink-0 text-xs text-brand hover:underline"
                >
                  + New
                </a>
              </div>
            </Field>
          )}
        </FieldRow>
        <Field label="Name" error={errs['name']} required>
          <Input
            name="name"
            required
            placeholder="Market landscape diligence"
            {...(prefill?.name ? { defaultValue: prefill.name } : {})}
          />
        </Field>
        <Field label="Description" error={errs['description']} hint="Optional">
          <textarea
            name="description"
            rows={3}
            defaultValue={prefill?.description ?? ''}
            className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Scope, key questions, deliverables…"
          />
        </Field>
      </Section>

      {isInternal ? (
        <Section title="Internal budget · optional">
          <p className="-mt-1 text-xs text-ink-3">
            Internal projects don&apos;t carry a contract or a P&amp;L —
            track them against a budget after create on the project
            detail page&apos;s Budget tab. Start / end dates are
            optional; leave blank for standing projects.
          </p>
          {/* Server still expects these fields — we send zeros + nulls
               so the same Zod schema accepts both branches. */}
          <input type="hidden" name="contractValueDollars" value="0" />
          <input type="hidden" name="estimatedWeeks" value="0" />
          <FieldRow>
            <Field
              label="Optional start"
              hint="Most FHP projects are standing — leave blank."
              error={errs['startDate']}
            >
              <Input name="startDate" type="date" defaultValue="" />
            </Field>
            <Field
              label="Optional end"
              hint="Episodic only (e.g. a conference)."
              error={errs['endDate']}
            >
              <Input name="endDate" type="date" defaultValue="" />
            </Field>
          </FieldRow>
        </Section>
      ) : (
        <Section title="Commercials">
          <CommercialsBlock
            initialContractDollars={
              prefill?.contractValueDollars !== undefined
                ? prefill.contractValueDollars
                : 0
            }
            fieldErrors={errs}
          />
        </Section>
      )}

      <Section title="Team">
        <FieldRow>
          <Field label="Primary partner" error={errs['primaryPartnerId']} required>
            <Select
              name="primaryPartnerId"
              required
              {...(prefill?.primaryPartnerId ? { defaultValue: prefill.primaryPartnerId } : {})}
            >
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
          create.
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

/**
 * Project-kind tile-radio. Single click swaps the entire form between
 * the client-engagement layout and the internal-FHP layout. We avoid
 * the native `<input type="radio">` look so the affordance reads as a
 * deliberate choice rather than a buried form input.
 */
function KindOption({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange()}
      aria-pressed={checked}
      disabled={disabled}
      className={`flex flex-col items-start gap-1 rounded-md border px-4 py-3 text-left transition-colors ${
        checked
          ? 'border-brand bg-brand-soft/30 text-ink shadow-sm'
          : 'border-line bg-surface-elev text-ink-2 hover:border-brand-soft hover:bg-surface-hover'
      } ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
    >
      <div className="flex w-full items-center gap-2">
        <span
          className={`inline-block h-3 w-3 rounded-full border ${
            checked
              ? 'border-brand bg-brand'
              : 'border-line bg-surface-elev'
          }`}
        />
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <span className="text-xs text-ink-3">{description}</span>
    </button>
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

/**
 * Commercials block with a live-calc strip — types into contract value
 * + estimated weeks; readout shows gross revenue / week, revenue post
 * Foundry OPEX (35%), and estimated project OPEX (50% placeholder).
 * Once a budget forecast is filled later, the project page can override
 * the OPEX estimate with the real forecasted figure.
 */
function CommercialsBlock({
  initialContractDollars,
  fieldErrors,
}: {
  initialContractDollars: number;
  fieldErrors: Record<string, string>;
}) {
  const [contractDollars, setContractDollars] = useState(
    initialContractDollars,
  );
  const [estimatedWeeks, setEstimatedWeeks] = useState<number>(0);

  // Constants per FY26 governance — Foundry OPEX contribution = 35% of
  // gross (covers firm OPEX 20% + profit pool 15%). Project OPEX
  // estimate = 50% of contract (placeholder until budget forecast).
  const FOUNDRY_TAKE_PCT = 35;
  const PROJECT_OPEX_PCT_PLACEHOLDER = 50;

  const grossPerWeek =
    estimatedWeeks > 0 ? contractDollars / estimatedWeeks : 0;
  const netRevenue = contractDollars * (1 - FOUNDRY_TAKE_PCT / 100);
  const netRevenuePerWeek =
    estimatedWeeks > 0 ? netRevenue / estimatedWeeks : 0;
  const estProjectOpex = contractDollars * (PROJECT_OPEX_PCT_PLACEHOLDER / 100);

  function fmt(d: number): string {
    if (!Number.isFinite(d) || d === 0) return '—';
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      maximumFractionDigits: 0,
    }).format(d);
  }

  return (
    <>
      <FieldRow>
        <Field
          label="Contract value (AUD, ex GST)"
          error={fieldErrors['contractValueDollars']}
          required
        >
          <Input
            name="contractValueDollars"
            type="number"
            min="0"
            max="10000000"
            step="1"
            required
            value={contractDollars || ''}
            onChange={(e) =>
              setContractDollars(Math.max(0, Number(e.target.value || 0)))
            }
            className="max-w-[200px]"
          />
        </Field>
        <Field
          label="Estimated number of weeks"
          hint="Drives the per-week revenue calc below"
        >
          <Input
            name="estimatedWeeks"
            type="number"
            min="0"
            max="520"
            step="1"
            value={estimatedWeeks || ''}
            onChange={(e) =>
              setEstimatedWeeks(Math.max(0, Number(e.target.value || 0)))
            }
            className="max-w-[140px]"
          />
        </Field>
        <Field
          label="Theoretical start"
          hint="Optional — reconcile before close"
          error={fieldErrors['startDate']}
        >
          <Input name="startDate" type="date" defaultValue="" />
        </Field>
        <Field
          label="Theoretical end"
          hint="Optional — reconcile before close"
          error={fieldErrors['endDate']}
        >
          <Input name="endDate" type="date" defaultValue="" />
        </Field>
      </FieldRow>

      <div className="rounded-md border border-line bg-surface-subtle/40 p-3 text-xs">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
          Quick estimate
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Stat
            label="Gross revenue / week"
            value={fmt(grossPerWeek)}
            sub={
              estimatedWeeks > 0
                ? `over ${estimatedWeeks} weeks`
                : 'enter weeks'
            }
          />
          <Stat
            label={`Revenue post Foundry OPEX (${FOUNDRY_TAKE_PCT}%)`}
            value={fmt(netRevenue)}
            sub={
              estimatedWeeks > 0
                ? `${fmt(netRevenuePerWeek)} / week`
                : 'after firm take'
            }
          />
          <Stat
            label={`Est. project OPEX (${PROJECT_OPEX_PCT_PLACEHOLDER}% placeholder)`}
            value={fmt(estProjectOpex)}
            sub="updates from budget forecast"
            tone="amber"
          />
        </div>
        <p className="mt-2 text-[10px] text-ink-3">
          Foundry OPEX = 20% firm OPEX + 15% profit pool per FY26
          governance. Project OPEX is a 50% placeholder until the
          project&apos;s budget forecast is filled in — at which point
          it&apos;ll reflect the actual modelled spend.
        </p>
      </div>

      <p className="mt-2 text-xs text-ink-3">
        Theoretical start + end are the plan, not a hard constraint. Skip them now
        if you don&apos;t know yet — you&apos;ll need to fill them in before moving
        the project to <span className="font-mono">closing</span> or{' '}
        <span className="font-mono">archived</span>.
      </p>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub: string;
  tone?: 'neutral' | 'amber';
}) {
  const valueClass =
    tone === 'amber' ? 'text-status-amber' : 'text-ink';
  return (
    <div className="rounded border border-line bg-card p-2">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">
        {label}
      </div>
      <div className={`text-sm font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
      <div className="text-[10px] text-ink-4">{sub}</div>
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
