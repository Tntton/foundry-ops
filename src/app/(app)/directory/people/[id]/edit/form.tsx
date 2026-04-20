'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { Role } from '@prisma/client';
import type { PersonDetail } from '@/server/directory';
import { updatePerson, type PersonEditActionState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const BANDS = ['MP', 'Partner', 'Expert', 'Consultant', 'Analyst'] as const;
const EMPLOYMENTS: Array<{ value: 'ft' | 'contractor'; label: string }> = [
  { value: 'ft', label: 'Full-time' },
  { value: 'contractor', label: 'Contractor' },
];
const REGIONS = ['AU', 'NZ'] as const;
const RATE_UNITS: Array<{ value: 'hour' | 'day'; label: string }> = [
  { value: 'hour', label: 'Hourly' },
  { value: 'day', label: 'Daily' },
];
const ROLES: Role[] = ['super_admin', 'admin', 'partner', 'manager', 'staff'];

export function PersonEditForm({ person }: { person: PersonDetail }) {
  const bound = updatePerson.bind(null, person.id);
  const [state, action] = useFormState<PersonEditActionState, FormData>(bound, {
    status: 'idle',
  });

  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};
  const rateDollars = person.rate > 0 ? (person.rate / 100).toFixed(0) : '0';

  return (
    <form action={action} className="space-y-6">
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}

      <Section title="Identity">
        <FieldRow>
          <Field label="First name" error={errs['firstName']}>
            <Input name="firstName" defaultValue={person.firstName} />
          </Field>
          <Field label="Last name" error={errs['lastName']}>
            <Input name="lastName" defaultValue={person.lastName} />
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
          <Field label="Band" error={errs['band']}>
            <Select name="band" defaultValue={person.band}>
              {BANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Level" error={errs['level']}>
            <Input name="level" defaultValue={person.level} className="max-w-[140px]" />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Employment" error={errs['employment']}>
            <Select name="employment" defaultValue={person.employment}>
              {EMPLOYMENTS.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="FTE (0.10 – 1.00)" error={errs['fte']}>
            <Input
              name="fte"
              type="number"
              step="0.05"
              min="0.10"
              max="1.00"
              defaultValue={person.fte.toFixed(2)}
              className="max-w-[140px]"
            />
          </Field>
          <Field label="Region" error={errs['region']}>
            <Select name="region" defaultValue={person.region}>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
        </FieldRow>
      </Section>

      <Section title="Pay">
        <FieldRow>
          <Field label="Rate unit" error={errs['rateUnit']}>
            <Select name="rateUnit" defaultValue={person.rateUnit}>
              {RATE_UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rate (AUD)" error={errs['rateDollars']}>
            <Input
              name="rateDollars"
              type="number"
              min="0"
              max="10000"
              step="1"
              defaultValue={rateDollars}
              className="max-w-[160px]"
            />
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
        {errs['roles'] && (
          <p className="mt-2 text-sm text-status-red">{errs['roles']}</p>
        )}
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
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-ink-3">{label}</label>
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
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      className={cn(
        'flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring',
      )}
    >
      {children}
    </select>
  );
}
