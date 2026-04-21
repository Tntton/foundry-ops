'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { saveBankDetails, type BankDetailsState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function BankDetailsForm({
  personId,
  bsbLast4,
  accLast4,
}: {
  personId: string;
  bsbLast4: string | null;
  accLast4: string | null;
}) {
  const bound = saveBankDetails.bind(null, personId);
  const [state, action] = useFormState<BankDetailsState, FormData>(bound, {
    status: 'idle',
  });
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

  return (
    <form action={action} className="space-y-4">
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

      <Field
        label="BSB"
        hint="6 digits; spaces and hyphens are stripped"
        error={errs['bsb']}
      >
        <Input
          name="bsb"
          placeholder={bsbLast4 ? `••• ${bsbLast4.slice(-3)}` : '062 001'}
          className="max-w-[200px] font-mono"
          autoComplete="off"
        />
      </Field>
      <Field
        label="Account number"
        hint="Up to 9 digits; no leading zeros required"
        error={errs['acc']}
      >
        <Input
          name="acc"
          placeholder={accLast4 ? `••• ${accLast4}` : '12345678'}
          className="max-w-[220px] font-mono"
          autoComplete="off"
        />
      </Field>

      <div className="flex items-center gap-2">
        <SaveButton />
        <p className="text-xs text-ink-3">
          Leave blank + Save to clear. Values encrypt at rest (AES-256-GCM).
        </p>
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save bank details'}
    </Button>
  );
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
