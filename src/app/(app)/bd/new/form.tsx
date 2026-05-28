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

const SECTORS = [
  'pharma',
  'biotech',
  'medtech',
  'digital-health',
  'payers',
  'providers',
  'health-services',
  'public-health',
  'cross-sector',
  'other',
] as const;

/**
 * Second-level classification keyed by sector. Surfaced as a dropdown
 * once a sector is picked. Curated to the most common sub-types in the
 * Foundry portfolio; partners can fall through to free-text "other".
 */
const SECTOR_SUBTYPES: Record<string, Array<{ v: string; label: string }>> = {
  providers: [
    { v: 'cardiology', label: 'Cardiology' },
    { v: 'general-practice', label: 'General practice' },
    { v: 'day-hospital', label: 'Day hospital' },
    { v: 'telehealth-general', label: 'Telehealth (general)' },
    { v: 'telehealth-vertical', label: 'Telehealth (vertical)' },
    { v: 'imaging', label: 'Imaging / radiology' },
    { v: 'pathology', label: 'Pathology' },
    { v: 'allied-health', label: 'Allied health' },
    { v: 'specialist-network', label: 'Specialist network' },
    { v: 'aged-care', label: 'Aged / residential care' },
    { v: 'mental-health', label: 'Mental health' },
    { v: 'primary-care-network', label: 'Primary care network' },
    { v: 'other', label: 'Other provider' },
  ],
  pharma: [
    { v: 'oncology', label: 'Oncology' },
    { v: 'cardiometabolic', label: 'Cardiometabolic' },
    { v: 'immunology', label: 'Immunology' },
    { v: 'neuroscience', label: 'Neuroscience' },
    { v: 'rare-disease', label: 'Rare disease' },
    { v: 'vaccines', label: 'Vaccines' },
    { v: 'other', label: 'Other therapy area' },
  ],
  biotech: [
    { v: 'clinical-stage', label: 'Clinical-stage' },
    { v: 'pre-clinical', label: 'Pre-clinical' },
    { v: 'platform', label: 'Platform / discovery' },
    { v: 'cell-gene', label: 'Cell & gene therapy' },
    { v: 'other', label: 'Other' },
  ],
  medtech: [
    { v: 'diagnostics', label: 'Diagnostics' },
    { v: 'devices', label: 'Devices' },
    { v: 'imaging', label: 'Imaging' },
    { v: 'digital-therapeutics', label: 'Digital therapeutics' },
    { v: 'other', label: 'Other medtech' },
  ],
  'digital-health': [
    { v: 'ehr-platform', label: 'EHR / platform' },
    { v: 'patient-engagement', label: 'Patient engagement' },
    { v: 'remote-monitoring', label: 'Remote monitoring' },
    { v: 'workflow-automation', label: 'Workflow automation' },
    { v: 'ai-ml', label: 'AI / ML' },
    { v: 'other', label: 'Other digital health' },
  ],
  payers: [
    { v: 'private-health-insurer', label: 'Private health insurer' },
    { v: 'reinsurer', label: 'Reinsurer' },
    { v: 'corporate-self-insured', label: 'Corporate self-insured' },
    { v: 'other', label: 'Other' },
  ],
  'health-services': [
    { v: 'consulting', label: 'Health consulting' },
    { v: 'professional-services', label: 'Professional services' },
    { v: 'data-analytics', label: 'Data / analytics' },
    { v: 'other', label: 'Other' },
  ],
  'public-health': [
    { v: 'federal', label: 'Federal' },
    { v: 'state-territory', label: 'State / territory' },
    { v: 'local-health-network', label: 'Local health network' },
    { v: 'phn', label: 'PHN' },
    { v: 'other', label: 'Other' },
  ],
};

const CLIENT_TYPES = [
  { v: 'mid-market-pe', label: 'Mid-market PE firm' },
  { v: 'large-pe', label: 'Large-cap PE firm' },
  { v: 'venture-capital', label: 'Venture capital' },
  { v: 'corporate', label: 'Corporate / strategic' },
  { v: 'pharma', label: 'Pharmaceutical co.' },
  { v: 'provider', label: 'Healthcare provider' },
  { v: 'government', label: 'Government / NFP' },
  { v: 'startup', label: 'Startup / SME' },
  { v: 'other', label: 'Other' },
] as const;

const ENGAGEMENT_TYPES = [
  { v: 'cdd', label: 'Commercial due diligence' },
  { v: 'strategy', label: 'Strategy' },
  { v: 'advisory', label: 'Advisory' },
  { v: 'jv', label: 'Joint venture / partnership' },
  { v: 'transaction-support', label: 'Transaction support' },
  { v: 'market-entry', label: 'Market entry' },
  { v: 'operational', label: 'Operational improvement' },
  { v: 'other', label: 'Other' },
] as const;

export function NewDealForm({
  clients,
  owners,
  defaultClientId,
}: {
  clients: ClientOpt[];
  owners: PartnerOpt[];
  /** Pre-selected client when navigated to from a client detail page. */
  defaultClientId?: string | null;
}) {
  const [state, action] = useFormState<NewDealState, FormData>(createDeal, {
    status: 'idle',
  });
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};
  const [useExisting, setUseExisting] = useState(true);
  // Sector + sub-type are controlled so picking a sector immediately
  // refreshes the sub-type dropdown options. Sub-type clears whenever
  // sector changes.
  const [sector, setSector] = useState<string>('');
  const [sectorSubtype, setSectorSubtype] = useState<string>('');
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-6">
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}

      <p className="text-xs text-ink-3">
        Fields marked with <span className="text-status-red">*</span> are required. A
        deal code is generated automatically.
      </p>

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
            <span>New client / prospective org</span>
          </label>
        </div>
        {useExisting ? (
          <Field label="Client" error={errs['clientId']} required>
            <select
              name="clientId"
              required
              defaultValue={defaultClientId ?? ''}
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
            label="New client / prospective name"
            hint="Converts to a real client record when the deal is won"
            error={errs['prospectiveName']}
            required
          >
            <Input name="prospectiveName" required placeholder="Acme Health Pty Ltd" />
          </Field>
        )}
        <Field
          label="Prospective project detail"
          hint="What the work is about — scope, key questions, deliverables. Will seed the Project description and Work Order template if the deal converts."
          error={errs['prospectiveProjectDetail']}
        >
          <textarea
            name="prospectiveProjectDetail"
            rows={4}
            placeholder="e.g. CDD on a $40m bolt-on. Two weeks of expert calls + market sizing + competitive map."
            className="flex w-full rounded-md border border-line bg-surface-elev px-2 py-1.5 text-sm text-ink"
          />
        </Field>
        <FieldRow>
          <Field label="Client type" error={errs['clientType']}>
            <Select name="clientType" defaultValue="">
              <option value="">—</option>
              {CLIENT_TYPES.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sector" error={errs['sector']}>
            <select
              name="sector"
              value={sector}
              onChange={(e) => {
                setSector(e.target.value);
                setSectorSubtype(''); // clear sub-type on sector change
              }}
              className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">—</option>
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Sub-type"
            hint={
              SECTOR_SUBTYPES[sector]
                ? 'Refines the sector classification'
                : 'Pick a sector first'
            }
            error={errs['sectorSubtype']}
          >
            <select
              name="sectorSubtype"
              value={sectorSubtype}
              onChange={(e) => setSectorSubtype(e.target.value)}
              disabled={!SECTOR_SUBTYPES[sector]}
              className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            >
              <option value="">—</option>
              {SECTOR_SUBTYPES[sector]?.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Engagement type" error={errs['engagementType']}>
            <Select name="engagementType" defaultValue="">
              <option value="">—</option>
              {ENGAGEMENT_TYPES.map((t) => (
                <option key={t.v} value={t.v}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
      </Section>

      <Section title="Deal">
        <FieldRow>
          <Field label="Deal name" hint="Optional — falls back to client + engagement" error={errs['name']}>
            <Input name="name" placeholder="Digital health strategy engagement" />
          </Field>
          <Field label="Stage" error={errs['stage']} required>
            <Select name="stage" defaultValue="lead">
              {STAGES.map((s) => (
                <option key={s.v} value={s.v}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Owner" error={errs['ownerId']} required>
            <Select name="ownerId" defaultValue="" required>
              <option value="">— Choose owner —</option>
              {owners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.initials} · {p.firstName} {p.lastName}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Secondary contact"
            hint="Optional · co-lead / second relationship holder"
            error={errs['secondaryOwnerId']}
          >
            <Select name="secondaryOwnerId" defaultValue="">
              <option value="">— None —</option>
              {owners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.initials} · {p.firstName} {p.lastName}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field
            label="Expected value (AUD, ex GST)"
            hint="Leave blank if scope isn't sized yet"
            error={errs['expectedValueDollars']}
          >
            <Input
              name="expectedValueDollars"
              type="number"
              min="0"
              max="100000000"
              step="1"
              placeholder="0"
            />
          </Field>
          <Field
            label="Probability (%)"
            hint="Leave blank if too early to call"
            error={errs['probability']}
          >
            <Input
              name="probability"
              type="number"
              min="0"
              max="100"
              step="5"
              placeholder="25"
            />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Conversations">
        <p className="-mt-1 text-xs text-ink-3">
          We track when you first spoke to the client and the most recent touch-point
          instead of a fixed close date — because real deals drift.
        </p>
        <FieldRow>
          <Field label="First conversation" error={errs['firstConversationAt']}>
            <Input
              name="firstConversationAt"
              type="date"
              max={today}
              defaultValue={today}
            />
          </Field>
          <Field label="Last conversation" error={errs['lastConversationAt']}>
            <Input
              name="lastConversationAt"
              type="date"
              max={today}
              defaultValue={today}
            />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Primary contact">
        <p className="-mt-1 text-xs text-ink-3">
          Leave blank if you don&apos;t have a named contact yet. More contacts can be
          added from the deal page.
        </p>
        <FieldRow>
          <Field label="Name" error={errs['contactName']}>
            <Input name="contactName" placeholder="Jane Smith" />
          </Field>
          <Field label="Role" error={errs['contactRole']}>
            <Input name="contactRole" placeholder="Head of Strategy" />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Email" error={errs['contactEmail']}>
            <Input name="contactEmail" type="email" placeholder="jane@example.com" />
          </Field>
          <Field label="Phone" error={errs['contactPhone']}>
            <Input name="contactPhone" placeholder="+61 4xx xxx xxx" />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Notes">
        <Field label="Notes" error={errs['notes']}>
          <textarea
            name="notes"
            rows={4}
            className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink"
            placeholder="Key context, competitive landscape, what the buyer cares about…"
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

function Select({
  name,
  defaultValue,
  required,
  children,
}: {
  name: string;
  defaultValue: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      required={required}
      className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
    >
      {children}
    </select>
  );
}
