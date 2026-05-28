'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { updateDealFields, type DealUpdateState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type EditableDeal = {
  id: string;
  name: string | null;
  sector: string | null;
  clientType: string | null;
  engagementType: string | null;
  expectedValueCents: number;
  probabilityPct: number;
  ownerId: string;
  clientId: string | null;
  prospectiveName: string | null;
  prospectiveProjectDetail: string | null;
  targetCloseDateIso: string | null;
};

export type DealEditOwner = {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
};
export type DealEditClient = {
  id: string;
  code: string;
  legalName: string;
};

const SECTOR_SUGGESTIONS = [
  'pharma',
  'biotech',
  'medtech',
  'digital-health',
  'aged-care',
  'public-health',
  'private-equity',
  'other',
];
const CLIENT_TYPE_SUGGESTIONS = [
  'corporate',
  'mid-market-pe',
  'startup',
  'government',
  'not-for-profit',
];
const ENGAGEMENT_SUGGESTIONS = [
  'cdd',
  'strategy',
  'advisory',
  'jv',
  'transaction-support',
  'market-entry',
  'other',
];

/**
 * One form, every editable key field. Save commits the whole snapshot;
 * blank inputs save as null/0 so partners can prune fields they no longer
 * want set without a separate "clear" action. Stage stays on its own
 * dedicated stage-form.tsx because its state machine is special.
 */
export function DealEditForm({
  deal,
  owners,
  clients,
}: {
  deal: EditableDeal;
  owners: DealEditOwner[];
  clients: DealEditClient[];
}) {
  const bound = updateDealFields.bind(null, deal.id);
  const [state, action] = useFormState<DealUpdateState, FormData>(bound, {
    status: 'idle',
  });

  // Controlled fields where a swap matters (clientId clears the
  // prospective inputs). Everything else uses defaultValue + form post.
  const [clientId, setClientId] = useState(deal.clientId ?? '');
  const [prospectiveName, setProspectiveName] = useState(
    deal.prospectiveName ?? '',
  );
  const [prospectiveDetail, setProspectiveDetail] = useState(
    deal.prospectiveProjectDetail ?? '',
  );

  return (
    <form action={action} className="space-y-4">
      <Section title="Identity">
        <FieldRow>
          <Field label="Deal name" hint="Short headline">
            <Input
              name="name"
              defaultValue={deal.name ?? ''}
              placeholder="e.g. Strategy refresh — H2 2026"
            />
          </Field>
          <Field label="Owner">
            <Select name="ownerId" defaultValue={deal.ownerId}>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.initials} · {o.firstName} {o.lastName}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
      </Section>

      <Section title="Client">
        <FieldRow>
          <Field label="Client" hint="Pick existing — or leave empty for prospective">
            <Select
              name="clientId"
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                if (e.target.value) {
                  // Clear prospective fields so we don't end up with
                  // both columns populated.
                  setProspectiveName('');
                }
              }}
            >
              <option value="">— prospective (type below) —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.legalName}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
        {!clientId && (
          <FieldRow>
            <Field label="Prospective name">
              <Input
                name="prospectiveName"
                value={prospectiveName}
                onChange={(e) => setProspectiveName(e.target.value)}
                placeholder="Acme Health Pty Ltd"
              />
            </Field>
          </FieldRow>
        )}
        {/* Prospective project detail — placed directly after the
            prospective name per the request. Free-form scope sketch the
            partner uses to brief the team and seed Project description /
            Work Order template if/when the deal converts. Visible whether
            or not a real client is picked, so a known client's new
            opportunity can still capture the brief here. */}
        <Field
          label="Prospective project detail"
          hint="What the work is about — scope, key questions, deliverables. Will seed the Project description and WO template if the deal converts."
        >
          <textarea
            name="prospectiveProjectDetail"
            value={prospectiveDetail}
            onChange={(e) => setProspectiveDetail(e.target.value)}
            rows={4}
            placeholder="e.g. CDD on a $40m bolt-on. Two weeks of expert calls + market sizing + competitive map."
            className="flex w-full rounded-md border border-line bg-surface-elev px-2 py-1.5 text-sm text-ink"
          />
        </Field>
      </Section>

      <Section title="Classification">
        <FieldRow>
          <Field label="Sector">
            <DataListInput
              name="sector"
              defaultValue={deal.sector ?? ''}
              suggestions={SECTOR_SUGGESTIONS}
              placeholder="pharma / biotech / medtech…"
            />
          </Field>
          <Field label="Client type">
            <DataListInput
              name="clientType"
              defaultValue={deal.clientType ?? ''}
              suggestions={CLIENT_TYPE_SUGGESTIONS}
              placeholder="corporate / mid-market-pe / startup…"
            />
          </Field>
          <Field label="Engagement type">
            <DataListInput
              name="engagementType"
              defaultValue={deal.engagementType ?? ''}
              suggestions={ENGAGEMENT_SUGGESTIONS}
              placeholder="cdd / strategy / advisory…"
            />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Commercials">
        <FieldRow>
          <Field
            label="Expected value (AUD ex GST)"
            hint="Leave blank if not sized"
          >
            <Input
              name="expectedValueDollars"
              type="number"
              min="0"
              max="100000000"
              step="1"
              defaultValue={
                deal.expectedValueCents > 0
                  ? String(Math.round(deal.expectedValueCents / 100))
                  : ''
              }
            />
          </Field>
          <Field label="Probability (%)" hint="Leave blank if too early">
            <Input
              name="probability"
              type="number"
              min="0"
              max="100"
              step="5"
              defaultValue={
                deal.probabilityPct > 0 ? String(deal.probabilityPct) : ''
              }
            />
          </Field>
          <Field label="Target close date">
            <Input
              name="targetCloseDate"
              type="date"
              defaultValue={deal.targetCloseDateIso ?? ''}
            />
          </Field>
        </FieldRow>
      </Section>

      {state.status === 'error' && (
        <p className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </p>
      )}
      {state.status === 'success' && (
        <p className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          {state.message}
        </p>
      )}

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save deal'}
    </Button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
        {title}
      </h3>
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
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-ink-3">
        {label}
        {hint && <span className="ml-2 font-normal text-ink-4">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Select({
  name,
  defaultValue,
  value,
  onChange,
  children,
}: {
  name: string;
  defaultValue?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      name={name}
      {...(value !== undefined
        ? { value, onChange }
        : { defaultValue: defaultValue ?? '' })}
      className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
    >
      {children}
    </select>
  );
}

/**
 * Free-form input with a `<datalist>` of suggestions — partners can pick
 * a known classification or type something custom. Keeps schema flexible
 * while still nudging consistency.
 */
function DataListInput({
  name,
  defaultValue,
  suggestions,
  placeholder,
}: {
  name: string;
  defaultValue: string;
  suggestions: string[];
  placeholder?: string;
}) {
  const listId = `${name}-suggestions`;
  return (
    <>
      <Input
        name={name}
        defaultValue={defaultValue}
        list={listId}
        placeholder={placeholder}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}
