'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useMemo, useState } from 'react';
import type { Role } from '@prisma/client';
import type { PersonDetail } from '@/server/directory';
import { updatePerson, type PersonEditActionState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { FOUNDRY_LEVELS, type LevelCode } from '@/lib/levels';
import { COUNTRY_OPTIONS } from '@/lib/countries';

const BANDS = ['MP', 'Partner', 'Expert', 'Consultant', 'Analyst'] as const;
const EMPLOYMENTS: Array<{ value: 'ft' | 'contractor'; label: string }> = [
  { value: 'ft', label: 'Full-time' },
  { value: 'contractor', label: 'Contractor' },
];
const RATE_UNITS: Array<{ value: 'hour' | 'day'; label: string }> = [
  { value: 'hour', label: 'Hourly' },
  { value: 'day', label: 'Daily' },
];
const ROLES: Role[] = ['super_admin', 'admin', 'partner', 'manager', 'staff'];

export function PersonEditForm({
  person,
  ratesByCode,
}: {
  person: PersonDetail;
  ratesByCode: Record<string, number>;
}) {
  const bound = updatePerson.bind(null, person.id);
  const [state, action] = useFormState<PersonEditActionState, FormData>(bound, {
    status: 'idle',
  });
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

  const initialLevel = (person.level as LevelCode) ?? 'T1';
  const [level, setLevel] = useState<LevelCode>(initialLevel);
  const [band, setBand] = useState<string>(person.band);
  const [employment, setEmployment] = useState<'ft' | 'contractor'>(person.employment);
  const [rateUnit, setRateUnit] = useState<'hour' | 'day'>(person.rateUnit);
  const [rateDollars, setRateDollars] = useState<string>(
    person.rate > 0 ? (person.rate / 100).toFixed(0) : '0',
  );
  // Leadership tier — partner / MP / AP. Layout hides the FTE
  // field for them since their capacity isn't tracked against a
  // pyramid baseline.
  const isLeadershipBandLocal =
    band === 'Partner' || band === 'MP' || band === 'Associate_Partner';
  const showFte = employment === 'ft' && !isLeadershipBandLocal;

  const levelMeta = useMemo(
    () => FOUNDRY_LEVELS.find((l) => l.code === level) ?? FOUNDRY_LEVELS[0]!,
    [level],
  );
  const currentRateCents = ratesByCode[level] ?? null;

  function handleLevelChange(newLevel: LevelCode) {
    setLevel(newLevel);
    const meta = FOUNDRY_LEVELS.find((l) => l.code === newLevel);
    if (meta) setBand(meta.band);
    const cents = ratesByCode[newLevel];
    if (cents !== undefined) {
      setRateDollars(String(cents / 100));
      setRateUnit('hour');
    }
  }

  return (
    <form action={action} className="space-y-6">
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}

      <Section title="Identity">
        <FieldRow>
          <Field label="First name" required error={errs['firstName']}>
            <Input name="firstName" defaultValue={person.firstName} required />
          </Field>
          <Field label="Last name" required error={errs['lastName']}>
            <Input name="lastName" defaultValue={person.lastName} required />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Email (read-only)">
            <Input defaultValue={person.email} disabled className="font-mono" />
          </Field>
          <Field label="Initials (read-only)">
            <Input defaultValue={person.initials} disabled />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Phone" error={errs['phone']}>
            <Input name="phone" defaultValue={person.phone ?? ''} placeholder="+61 400 …" />
          </Field>
          <Field label="WhatsApp" error={errs['whatsappNumber']}>
            <Input
              name="whatsappNumber"
              defaultValue={person.whatsappNumber ?? ''}
              placeholder="+61 400 …"
            />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Employment">
        <FieldRow>
          <Field label="Level" required error={errs['level']} hint="Picks band + cost rate">
            <Select
              name="level"
              value={level}
              onChange={(e) => handleLevelChange(e.target.value as LevelCode)}
              required
            >
              {FOUNDRY_LEVELS.map((l) => {
                const cents = ratesByCode[l.code];
                const rateHint = cents
                  ? ` · $${(cents / 100).toFixed(0)}/hr`
                  : l.band === 'Partner'
                    ? ' · FT rate'
                    : '';
                return (
                  <option key={l.code} value={l.code}>
                    {l.code} — {l.label}
                    {rateHint}
                  </option>
                );
              })}
            </Select>
          </Field>
          <Field label="Band" required error={errs['band']}>
            <Select
              name="band"
              value={band}
              onChange={(e) => setBand(e.target.value)}
              required
            >
              {BANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Employment" required error={errs['employment']}>
            <Select
              name="employment"
              value={employment}
              onChange={(e) => setEmployment(e.target.value as 'ft' | 'contractor')}
              required
            >
              {EMPLOYMENTS.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="FTE (0.10 – 1.00)"
            error={errs['fte']}
            hint={
              !showFte
                ? employment === 'contractor'
                  ? 'Contractors are casual — leave blank'
                  : 'Partners — n/a'
                : undefined
            }
          >
            <Input
              name="fte"
              type="number"
              step="0.05"
              min="0.10"
              max="1.00"
              defaultValue={person.fte !== null ? person.fte.toFixed(2) : ''}
              disabled={!showFte}
              className="max-w-[140px]"
            />
          </Field>
          <Field label="Country" required error={errs['region']}>
            <Select name="region" defaultValue={person.region || 'AU'} required>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
        <Field label="Mailing address" error={errs['mailingAddress']} hint="Optional — for contracts + payroll">
          <textarea
            name="mailingAddress"
            rows={2}
            defaultValue={person.mailingAddress ?? ''}
            className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </Field>
        <p className="text-xs text-ink-3">
          Selected level: <span className="font-mono">{levelMeta.code}</span> ·{' '}
          <span className="text-ink-2">{levelMeta.label}</span>
          {currentRateCents !== null && (
            <>
              {' '}· current rate card:{' '}
              <span className="font-mono">${(currentRateCents / 100).toFixed(0)}/hr</span>
            </>
          )}
        </p>
      </Section>

      <Section title="Pay">
        <FieldRow>
          <Field label="Rate unit" required error={errs['rateUnit']}>
            <Select
              name="rateUnit"
              value={rateUnit}
              onChange={(e) => setRateUnit(e.target.value as 'hour' | 'day')}
              required
            >
              {RATE_UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Rate (AUD)"
            required
            error={errs['rateDollars']}
            hint="Auto-fills from rate card when Level changes"
          >
            <Input
              name="rateDollars"
              type="number"
              min="0"
              max="10000"
              step="1"
              value={rateDollars}
              onChange={(e) => setRateDollars(e.target.value)}
              required
              className="max-w-[160px]"
            />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Company">
        <p className="-mt-1 text-xs text-ink-3">
          For contractors — the consulting business they bill from.
          Optional for staff/partners. The logo is auto-resolved from
          the website (Clearbit).
        </p>
        <FieldRow>
          <Field
            label="Website"
            error={errs['website']}
            hint="https://… or example.com.au"
          >
            <CompanyWebsiteInput defaultValue={person.website ?? ''} email={person.email} />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Roles">
        <div className="flex flex-wrap gap-3">
          {ROLES.map((r) => {
            const checked = person.roles.includes(r);
            return (
              <label
                key={r}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover"
              >
                <input type="checkbox" name="roles" value={r} defaultChecked={checked} />
                <span className="capitalize">{r.replace('_', ' ')}</span>
              </label>
            );
          })}
        </div>
        {errs['roles'] && <p className="mt-2 text-sm text-status-red">{errs['roles']}</p>}
      </Section>

      <div className="flex justify-end gap-2">
        <Button type="button" asChild variant="ghost">
          <a href={`/directory/people/${person.id}`}>Cancel</a>
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
      {pending ? 'Saving…' : 'Save changes'}
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
  return <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr]">{children}</div>;
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
  value,
  defaultValue,
  required,
  onChange,
  children,
}: {
  name: string;
  value?: string;
  defaultValue?: string;
  required?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      name={name}
      value={value}
      defaultValue={defaultValue}
      required={required}
      onChange={onChange}
      className={cn(
        'flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring',
      )}
    >
      {children}
    </select>
  );
}

/**
 * Controlled website input + Clearbit logo preview. The preview falls
 * back to the email-derived domain when the website is blank — so a
 * contractor with `john@johnconsulting.com.au` automatically gets a
 * preview without typing the website explicitly.
 */
function CompanyWebsiteInput({
  defaultValue,
  email,
}: {
  defaultValue: string;
  email: string;
}) {
  const [val, setVal] = useState(defaultValue);
  const logo = previewLogoUrl(val) ?? previewLogoUrl(email);
  return (
    <div className="flex items-center gap-3">
      <Input
        name="website"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="https://www.consulting.com.au"
        className="flex-1"
      />
      <CompanyLogoPreview src={logo} alt="company logo" />
    </div>
  );
}

function previewLogoUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  let host: string | null = null;
  if (trimmed.includes('@')) {
    const at = trimmed.lastIndexOf('@');
    if (at > 0 && at < trimmed.length - 1) host = trimmed.slice(at + 1);
  } else {
    const withProto = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      host = new URL(withProto).host;
    } catch {
      host = null;
    }
  }
  if (!host) return null;
  if (host.startsWith('www.')) host = host.slice(4);
  const colon = host.indexOf(':');
  if (colon >= 0) host = host.slice(0, colon);
  if (!host.includes('.')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  return `https://logo.clearbit.com/${host}`;
}

function CompanyLogoPreview({ src, alt }: { src: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-line bg-surface-subtle text-[9px] uppercase tracking-wide text-ink-4">
        No logo
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setBroken(true)}
      className="h-10 w-10 shrink-0 rounded-md border border-line bg-white object-contain p-1"
    />
  );
}
