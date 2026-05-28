'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { updateOwnContactDetails, type MeUpdateState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const initial: MeUpdateState = { status: 'idle' };

export function MyContactForm({
  defaultPhone,
  defaultWhatsApp,
  defaultMailingAddress,
}: {
  defaultPhone: string | null;
  defaultWhatsApp: string | null;
  defaultMailingAddress: string | null;
}) {
  const [state, action] = useFormState(updateOwnContactDetails, initial);
  const errs = state.status === 'error' ? state.fieldErrors ?? {} : {};

  return (
    <form action={action} className="space-y-3">
      <Field label="Phone" hint="Optional · used for emergency contact" error={errs['phone']}>
        <Input
          name="phone"
          defaultValue={defaultPhone ?? ''}
          placeholder="+61 412 345 678"
        />
      </Field>
      <Field
        label="WhatsApp number"
        hint="E.164 format · used for high-value approval auth"
        error={errs['whatsappNumber']}
      >
        <Input
          name="whatsappNumber"
          defaultValue={defaultWhatsApp ?? ''}
          placeholder="+61412345678"
          className="font-mono"
        />
      </Field>
      <Field
        label="Mailing address"
        hint="Where Foundry can post statements / equipment"
        error={errs['mailingAddress']}
      >
        <textarea
          name="mailingAddress"
          defaultValue={defaultMailingAddress ?? ''}
          rows={3}
          placeholder="Level 5, 123 Macquarie St, Sydney NSW 2000"
          className="flex w-full rounded-md border border-line bg-surface-elev px-2 py-1.5 text-sm text-ink"
        />
      </Field>

      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}

      <div className="flex justify-end">
        <SaveButton />
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Save contact details'}
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
        {hint && <span className="ml-2 font-normal text-ink-4">· {hint}</span>}
      </label>
      {children}
      {error && <p className="text-xs text-status-red">{error}</p>}
    </div>
  );
}
