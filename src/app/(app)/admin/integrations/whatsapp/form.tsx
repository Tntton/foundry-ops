'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import {
  sendWhatsAppTest,
  registerWhatsAppNumber,
  type WhatsAppTestState,
  type WhatsAppRegisterState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const idle: WhatsAppTestState = { status: 'idle' };
const idleReg: WhatsAppRegisterState = { status: 'idle' };

const DEFAULT_MESSAGE =
  'Foundry Ops test — if you can read this, WhatsApp integration is wired up correctly.';

export function WhatsAppTestForm({ defaultToNumber }: { defaultToNumber: string }) {
  const [state, action] = useFormState<WhatsAppTestState, FormData>(
    sendWhatsAppTest,
    idle,
  );
  const [regState, regAction] = useFormState<WhatsAppRegisterState, FormData>(
    registerWhatsAppNumber,
    idleReg,
  );
  const [toNumber, setToNumber] = useState(defaultToNumber);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [pin, setPin] = useState('');

  return (
    <div className="space-y-6">
      {/* Register-number panel — only relevant the first time around
          (or when Meta returns 133010 "Account not registered"). Pick
          any 6-digit PIN; Meta stores it for re-registration 2FA. */}
      <form action={regAction} className="space-y-2 rounded-md border border-line bg-surface-subtle/30 p-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
          Register phone number (one-time)
        </div>
        <p className="text-xs text-ink-3">
          Required before the first send. Pick any 6-digit PIN — store it in
          1Password (Meta uses it as 2FA if the number needs re-registering).
        </p>
        <div className="flex items-center gap-2">
          <Input
            name="pin"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="123456"
            maxLength={6}
            pattern="[0-9]{6}"
            inputMode="numeric"
            required
            className="w-32 font-mono"
          />
          <RegisterSubmit />
          {regState.status === 'success' && (
            <span className="text-xs text-status-green">{regState.message}</span>
          )}
          {regState.status === 'error' && (
            <span className="text-xs text-status-red">{regState.message}</span>
          )}
        </div>
      </form>

    <form action={action} className="space-y-3">
      <div>
        <label className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Recipient (E.164, e.g. +61400123456)
        </label>
        <Input
          name="toNumber"
          value={toNumber}
          onChange={(e) => setToNumber(e.target.value)}
          placeholder="+61400123456"
          required
          className="font-mono"
        />
      </div>
      <div>
        <label className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Message
        </label>
        <textarea
          name="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          maxLength={1000}
          required
          className="w-full resize-y rounded-md border border-line bg-surface-elev px-2 py-1.5 text-sm text-ink"
        />
        <p className="mt-1 text-[11px] text-ink-3">
          Free-form text. Meta accepts this only when the recipient is
          on the verified test-recipient list.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Submit />
        {state.status === 'success' && (
          <span className="text-xs text-status-green">
            ✓ Sent · provider id <code className="font-mono">{state.providerMessageId}</code>
          </span>
        )}
        {state.status === 'error' && (
          <span className="text-xs text-status-red">{state.message}</span>
        )}
      </div>
    </form>
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Sending…' : 'Send test message'}
    </Button>
  );
}

function RegisterSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Registering…' : 'Register'}
    </Button>
  );
}
