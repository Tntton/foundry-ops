'use client';

import { useFormState, useFormStatus } from 'react-dom';
import {
  connectNavanAction,
  disconnectNavanAction,
  runNavanSyncAction,
  importNavanCsvAction,
  type ConnectNavanState,
  type DisconnectNavanState,
  type RunSyncState,
  type ImportCsvState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const idle: ConnectNavanState = { status: 'idle' };

/**
 * Connect form — captures API key + secret + optional org id and
 * persists them encrypted via `saveNavanConnection`. The secret never
 * round-trips back to the client after submission.
 */
export function ConnectForm() {
  const [state, action] = useFormState<ConnectNavanState, FormData>(
    connectNavanAction,
    idle,
  );
  return (
    <form action={action} className="space-y-3">
      <Field label="API key">
        <Input
          name="apiKey"
          required
          autoComplete="off"
          className="font-mono"
        />
      </Field>
      <Field label="API secret">
        <Input
          name="apiSecret"
          required
          type="password"
          autoComplete="new-password"
          className="font-mono"
        />
      </Field>
      <Field label="Org id" hint="Optional · shown on the connection card.">
        <Input name="orgId" autoComplete="off" />
      </Field>
      <details className="rounded-md border border-line bg-surface-subtle/40 p-3 text-xs text-ink-3">
        <summary className="cursor-pointer text-ink-2">
          Endpoint overrides (only if Navan&apos;s docs list non-default paths)
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-[11px]">
            Defaults match the Navan Booking Data Integration (BDI)
            docs:{' '}
            <code className="font-mono">
              https://api.navan.com/ta-auth/oauth/token
            </code>{' '}
            for auth,{' '}
            <code className="font-mono">
              https://api.navan.com/v1/bookings
            </code>{' '}
            for bookings. The BDI credential type doesn&apos;t cover
            expenses — leave the Expenses URL blank unless Navan has
            granted your tenant a separate Expense API endpoint, in
            which case paste it below to also pull expenses.
          </p>
          <Field
            label="Token URL"
            hint="OAuth client_credentials endpoint."
          >
            <Input
              name="tokenUrl"
              type="url"
              autoComplete="off"
              placeholder="https://api.navan.com/oauth2/token"
              className="font-mono text-xs"
            />
          </Field>
          <Field
            label="Bookings URL"
            hint="GET endpoint for /v1/bookings."
          >
            <Input
              name="bookingsUrl"
              type="url"
              autoComplete="off"
              placeholder="https://api.navan.com/v1/bookings"
              className="font-mono text-xs"
            />
          </Field>
          <Field
            label="Expenses URL"
            hint="GET endpoint for /v1/expenses."
          >
            <Input
              name="expensesUrl"
              type="url"
              autoComplete="off"
              placeholder="https://api.navan.com/v1/expenses"
              className="font-mono text-xs"
            />
          </Field>
        </div>
      </details>
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
      {pending ? 'Connecting…' : 'Connect Navan'}
    </Button>
  );
}

const disconnectIdle: DisconnectNavanState = { status: 'idle' };

export function DisconnectButton() {
  // Pass the server action directly — wrapping it in an arrow lambda
  // strips React's server-action call path, so `getSession()` inside
  // the action returned null and the request 403'd with a confusing
  // "Not authorized" notification.
  const [state, action] = useFormState<DisconnectNavanState, FormData>(
    disconnectNavanAction,
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
    <Button
      type="submit"
      size="sm"
      variant="outline"
      disabled={pending}
    >
      {pending ? 'Disconnecting…' : 'Disconnect'}
    </Button>
  );
}

const syncIdle: RunSyncState = { status: 'idle' };

export function RunSyncButton() {
  // Same fix as DisconnectButton — pass the server action directly so
  // it stays inside React's server-action call path and the
  // `getSession()` inside resolves correctly.
  const [state, action] = useFormState<RunSyncState, FormData>(
    runNavanSyncAction,
    syncIdle,
  );
  return (
    <form action={action} className="space-y-2">
      <SyncSubmit />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">
          Synced · imported {state.imported}
          {state.skipped ? ` · skipped ${state.skipped} (already imported)` : ''}
          {state.unmatched.length > 0 && (
            <>
              {' '}· unmatched travellers:{' '}
              <span className="font-mono">{state.unmatched.join(', ')}</span>
            </>
          )}
          .
        </p>
      )}
    </form>
  );
}

function SyncSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Syncing…' : 'Run sync now'}
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

const csvIdle: ImportCsvState = { status: 'idle' };

/**
 * Manual CSV import path — works whether or not the live API
 * is connected. Useful for backfilling bookings made before the
 * integration was wired up, or as a fallback when the BDI API
 * isn't returning data.
 */
export function ImportCsvButton() {
  const [state, action] = useFormState<ImportCsvState, FormData>(
    importNavanCsvAction,
    csvIdle,
  );
  return (
    <form action={action} encType="multipart/form-data" className="space-y-2">
      <Field
        label="Bookings report (CSV)"
        hint="Navan admin → Reports → Bookings → Download CSV."
      >
        <Input
          name="csv"
          type="file"
          accept=".csv,text/csv"
          required
          className="text-xs"
        />
      </Field>
      <ImportSubmit />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">
          Imported <strong>{state.imported}</strong> · skipped {state.skipped}{' '}
          (already imported) · voided rows dropped: {state.voided}
          {state.projectAutoTagged > 0 && (
            <>
              {' '}· auto-tagged {state.projectAutoTagged} to projects via
              trip-name match
            </>
          )}
          {state.unmatched.length > 0 && (
            <>
              {' '}· unmatched travellers:{' '}
              <span className="font-mono">
                {state.unmatched.join(', ')}
              </span>
            </>
          )}
          .
        </p>
      )}
    </form>
  );
}

function ImportSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Importing…' : 'Import bookings'}
    </Button>
  );
}
