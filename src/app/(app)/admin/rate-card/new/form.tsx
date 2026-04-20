'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createRateCardVersion, type RateCardState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function NewRateCardForm() {
  const [state, action] = useFormState<RateCardState, FormData>(createRateCardVersion, {
    status: 'idle',
  });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-4 rounded-lg border border-line bg-card p-5">
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <Field label="Role code" hint="e.g. L2, T3, IO">
          <Input
            name="roleCode"
            required
            placeholder="T2"
            className="font-mono uppercase max-w-[120px]"
          />
        </Field>
        <Field label="Effective from">
          <Input name="effectiveFrom" type="date" required defaultValue={today} />
        </Field>
        <Field label="Cost / hr (AUD)">
          <Input name="costRate" type="number" min="0" step="1" required placeholder="120" />
        </Field>
        <Field label="Bill rate low (AUD)">
          <Input name="billRateLow" type="number" min="0" step="1" required placeholder="240" />
        </Field>
        <Field label="Bill rate high (AUD)">
          <Input name="billRateHigh" type="number" min="0" step="1" required placeholder="360" />
        </Field>
      </div>

      <p className="text-xs text-ink-3">
        Versioning by design: this creates a new row, never mutates existing. Historical
        rates remain readable via the &ldquo;Active as of&rdquo; selector.
      </p>

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
      {pending ? 'Saving…' : 'Create version'}
    </Button>
  );
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
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-ink-3">
        {label}
        {hint && <span className="ml-2 text-ink-4">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}
