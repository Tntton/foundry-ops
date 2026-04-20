'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useMemo, useState } from 'react';
import { createPerson, type NewPersonState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FOUNDRY_LEVELS, type LevelCode } from '@/lib/levels';

const BANDS = ['MP', 'Partner', 'Expert', 'Consultant', 'Analyst'] as const;
const EMPLOYMENTS = [
  { v: 'ft' as const, label: 'Full-time' },
  { v: 'contractor' as const, label: 'Contractor' },
];
const REGIONS = ['AU', 'NZ'] as const;
const RATE_UNITS = [
  { v: 'day' as const, label: 'Daily' },
  { v: 'hour' as const, label: 'Hourly' },
];
const ROLES = ['super_admin', 'admin', 'partner', 'manager', 'staff'] as const;

export function NewPersonForm({
  provisioningOn,
  ratesByCode,
}: {
  provisioningOn: boolean;
  ratesByCode: Record<string, number>;
}) {
  const [state, action] = useFormState<NewPersonState, FormData>(createPerson, {
    status: 'idle',
  });
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};
  const today = new Date().toISOString().slice(0, 10);

  // Client-side: when level changes, auto-fill rate from the current rate card
  // and flip rateUnit to hour + sync band.
  const [level, setLevel] = useState<LevelCode>('T1');
  const [rateDollars, setRateDollars] = useState<string>(() => {
    const cents = ratesByCode['T1'];
    return cents ? String(cents / 100) : '0';
  });
  const [rateUnit, setRateUnit] = useState<'hour' | 'day'>('hour');
  const [band, setBand] = useState<string>('Consultant');

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
            <Input name="firstName" required />
          </Field>
          <Field label="Last name" required error={errs['lastName']}>
            <Input name="lastName" required />
          </Field>
          <Field
            label="Initials override"
            hint="Auto-derived from name if blank"
            error={errs['initialsOverride']}
          >
            <Input
              name="initialsOverride"
              maxLength={6}
              className="max-w-[120px] font-mono uppercase"
            />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field
            label="Work email"
            required
            error={errs['email']}
            hint="FT requires @foundry.health"
          >
            <Input name="email" type="email" required className="font-mono" />
          </Field>
          <Field label="Job title" error={errs['jobTitle']}>
            <Input name="jobTitle" placeholder="Consultant / Partner / …" />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Phone" error={errs['phone']}>
            <Input name="phone" placeholder="+61 400 …" />
          </Field>
          <Field label="WhatsApp" error={errs['whatsappNumber']}>
            <Input name="whatsappNumber" placeholder="+61 400 …" />
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
          <Field label="Region" required error={errs['region']}>
            <Select name="region" defaultValue="AU" required>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Employment" required error={errs['employment']}>
            <Select name="employment" defaultValue="ft" required>
              {EMPLOYMENTS.map((e) => (
                <option key={e.v} value={e.v}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="FTE (0.10 – 1.00)" required error={errs['fte']}>
            <Input
              name="fte"
              type="number"
              step="0.05"
              min="0.10"
              max="1.00"
              defaultValue="1.00"
              required
              className="max-w-[140px]"
            />
          </Field>
          <Field label="Start date" required error={errs['startDate']}>
            <Input name="startDate" type="date" required defaultValue={today} />
          </Field>
        </FieldRow>
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
                <option key={u.v} value={u.v}>
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

      <Section title="Roles">
        <div className="flex flex-wrap gap-3">
          {ROLES.map((r) => (
            <label
              key={r}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover"
            >
              <input
                type="checkbox"
                name="roles"
                value={r}
                defaultChecked={r === 'staff'}
              />
              <span className="capitalize">{r.replace('_', ' ')}</span>
            </label>
          ))}
        </div>
      </Section>

      <div className="rounded-md border border-line bg-surface-subtle p-3 text-xs text-ink-3">
        {provisioningOn ? (
          <>
            <strong>M365 provisioning is ON.</strong> Creating an FT person will auto-provision
            a Microsoft 365 account with a temporary password (shown once on the next
            screen). Contractors don&apos;t get M365 accounts.
          </>
        ) : (
          <>
            M365 provisioning is <strong>OFF</strong> (set{' '}
            <code className="font-mono">ENABLE_PROVISIONING=1</code> in env to turn on).
            Person will be created in Foundry Ops only.
          </>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" asChild variant="ghost">
          <a href="/directory">Cancel</a>
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
      {pending ? 'Creating…' : 'Create person'}
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
      className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {children}
    </select>
  );
}
