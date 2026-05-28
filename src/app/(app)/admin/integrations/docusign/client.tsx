'use client';

import { useFormState, useFormStatus } from 'react-dom';
import {
  connectDocuSignAction,
  disconnectDocuSignAction,
  stampConsentAction,
  type ConnectDocuSignState,
  type DisconnectDocuSignState,
  type ConsentStampState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const idle: ConnectDocuSignState = { status: 'idle' };

export function ConnectForm({
  initialEnvironment = 'demo',
}: {
  initialEnvironment?: 'demo' | 'prod';
}) {
  const [state, action] = useFormState<ConnectDocuSignState, FormData>(
    connectDocuSignAction,
    idle,
  );
  return (
    <form action={action} className="space-y-3">
      <Field label="Integration Key (Client ID)">
        <Input
          name="integrationKey"
          required
          autoComplete="off"
          placeholder="00000000-0000-0000-0000-000000000000"
          className="font-mono text-xs"
        />
      </Field>
      <Field
        label="API User GUID"
        hint="The DocuSign user the JWT impersonates."
      >
        <Input
          name="apiUserId"
          required
          autoComplete="off"
          placeholder="00000000-0000-0000-0000-000000000000"
          className="font-mono text-xs"
        />
      </Field>
      <Field
        label="Account ID"
        hint="From DocuSign Admin → API and Keys → API Account ID."
      >
        <Input
          name="accountId"
          required
          autoComplete="off"
          placeholder="00000000-0000-0000-0000-000000000000"
          className="font-mono text-xs"
        />
      </Field>
      <Field
        label="Private key (PEM)"
        hint="The RSA private key paired with the public key uploaded to DocuSign. Stored AES-GCM encrypted."
      >
        <textarea
          name="privateKeyPem"
          required
          rows={6}
          autoComplete="off"
          placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;…&#10;-----END RSA PRIVATE KEY-----"
          className="block w-full rounded-md border border-line bg-surface-elev px-2 py-1.5 font-mono text-xs text-ink"
        />
      </Field>
      <Field
        label="HMAC secret"
        hint="From DocuSign Admin → Connect → your config → HMAC Security."
      >
        <Input
          name="hmacSecret"
          required
          type="password"
          autoComplete="new-password"
          className="font-mono text-xs"
        />
      </Field>
      <Field
        label="Environment"
        hint="Demo is the sandbox at demo.docusign.net; Production hits the live tenant."
      >
        <select
          name="environment"
          defaultValue={initialEnvironment}
          className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
        >
          <option value="demo">Demo (sandbox)</option>
          <option value="prod">Production</option>
        </select>
      </Field>
      <ConnectSubmit />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}
    </form>
  );
}

function ConnectSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Connecting…' : 'Connect DocuSign'}
    </Button>
  );
}

const disconnectIdle: DisconnectDocuSignState = { status: 'idle' };

export function DisconnectButton() {
  const [state, action] = useFormState<DisconnectDocuSignState, FormData>(
    disconnectDocuSignAction,
    disconnectIdle,
  );
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <DisconnectSubmit />
      {state.status === 'error' && (
        <span className="text-xs text-status-red">{state.message}</span>
      )}
      {state.status === 'success' && (
        <span className="text-xs text-status-green">Disconnected.</span>
      )}
    </form>
  );
}

function DisconnectSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? 'Disconnecting…' : 'Disconnect'}
    </Button>
  );
}

const consentIdle: ConsentStampState = { status: 'idle' };

/**
 * Admin clicks this AFTER visiting the consent URL in a separate
 * tab + accepting the DocuSign prompt. We stamp `consentedAt` so
 * the integration card shows the status. The next JWT exchange is
 * the canonical verification — it'll fail with 'consent_required'
 * if consent wasn't actually granted.
 */
export function StampConsentButton() {
  const [state, action] = useFormState<ConsentStampState, FormData>(
    stampConsentAction,
    consentIdle,
  );
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <StampSubmit />
      {state.status === 'error' && (
        <span className="text-xs text-status-red">{state.message}</span>
      )}
      {state.status === 'success' && (
        <span className="text-xs text-status-green">Stamped.</span>
      )}
    </form>
  );
}

function StampSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'I granted consent'}
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
    <div className="space-y-1">
      <label className="block text-xs font-medium text-ink-3">
        {label}
        {hint && <span className="ml-2 text-ink-4">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}
