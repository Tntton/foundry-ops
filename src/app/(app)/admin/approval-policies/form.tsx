'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { upsertPolicy, type PolicyState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function NewPolicyForm() {
  const [state, action] = useFormState<PolicyState, FormData>(upsertPolicy, {
    status: 'idle',
  });

  return (
    <form action={action} className="space-y-3 rounded-lg border border-line bg-card p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">New policy</h2>
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}
      {state.status === 'success' && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          {state.message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <Field label="Subject type">
          <select
            name="subjectType"
            className="h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm"
            defaultValue="expense"
            required
          >
            <option value="invoice">invoice</option>
            <option value="expense">expense</option>
            <option value="bill">bill</option>
            <option value="pay_run">pay_run</option>
            <option value="contract">contract</option>
            <option value="new_hire">new_hire</option>
            <option value="rate_change">rate_change</option>
          </select>
        </Field>
        <Field label="Comparator">
          <select
            name="comparator"
            className="h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm"
            defaultValue="gt"
            required
          >
            <option value="gt">&gt; (over)</option>
            <option value="gte">≥ (at or over)</option>
            <option value="lt">&lt; (under)</option>
            <option value="lte">≤ (at or under)</option>
            <option value="any">any (no threshold)</option>
          </select>
        </Field>
        <Field label="Threshold (AUD)">
          <Input name="thresholdDollars" type="number" min="0" step="1" placeholder="e.g. 2000" />
        </Field>
        <Field label="Required role">
          <select
            name="requiredRole"
            className="h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm"
            defaultValue="super_admin"
            required
          >
            <option value="super_admin">super_admin</option>
            <option value="admin">admin</option>
            <option value="partner">partner</option>
            <option value="manager">manager</option>
            <option value="staff">staff</option>
          </select>
        </Field>
        <Field label="Require MFA">
          <label className="flex h-9 items-center gap-2">
            <input type="checkbox" name="requireMfa" />
            <span className="text-sm text-ink-2">for high-value</span>
          </label>
        </Field>
      </div>

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
      {pending ? 'Saving…' : 'Add policy'}
    </Button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-ink-3">{label}</label>
      {children}
    </div>
  );
}
