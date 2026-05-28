'use client';

import { useFormState, useFormStatus } from 'react-dom';
import {
  connectUberAction,
  disconnectUberAction,
  runUberSyncAction,
  importUberCsvAction,
  configureUberSftpAction,
  clearUberSftpAction,
  runUberSftpPullAction,
  type ConnectUberState,
  type DisconnectUberState,
  type RunSyncState,
  type ImportCsvState,
  type ConfigureSftpState,
  type ClearSftpState,
  type RunSftpPullState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const idle: ConnectUberState = { status: 'idle' };

export function ConnectForm() {
  const [state, action] = useFormState<ConnectUberState, FormData>(
    connectUberAction,
    idle,
  );
  return (
    <form action={action} className="space-y-3">
      <Field label="Client ID">
        <Input
          name="clientId"
          required
          autoComplete="off"
          className="font-mono"
        />
      </Field>
      <Field label="Client Secret">
        <Input
          name="clientSecret"
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
          Endpoint &amp; scope overrides (only when Uber&apos;s docs list
          non-default paths for your tenant)
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-[11px]">
            Defaults match Uber for Business&apos; published API docs:{' '}
            <code className="font-mono">
              https://login.uber.com/oauth/v2/token
            </code>{' '}
            for auth,{' '}
            <code className="font-mono">
              https://api.uber.com/v1/business/trips
            </code>{' '}
            for trips. Scope defaults to{' '}
            <code className="font-mono">business.trips:read</code>; set
            it explicitly to{' '}
            <code className="font-mono">
              business.trips:read business.orders:read
            </code>{' '}
            once you&apos;ve added Eats support to the credential.
          </p>
          <Field label="Token URL">
            <Input
              name="tokenUrl"
              type="url"
              autoComplete="off"
              placeholder="https://login.uber.com/oauth/v2/token"
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Trips URL">
            <Input
              name="tripsUrl"
              type="url"
              autoComplete="off"
              placeholder="https://api.uber.com/v1/business/trips"
              className="font-mono text-xs"
            />
          </Field>
          <Field label="Scope">
            <Input
              name="scope"
              autoComplete="off"
              placeholder="business.trips:read"
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
      {pending ? 'Connecting…' : 'Connect Uber for Business'}
    </Button>
  );
}

const disconnectIdle: DisconnectUberState = { status: 'idle' };

export function DisconnectButton() {
  const [state, action] = useFormState<DisconnectUberState, FormData>(
    disconnectUberAction,
    disconnectIdle,
  );
  return (
    <form
      action={action}
      className="inline-flex flex-wrap items-center gap-2"
    >
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

const syncIdle: RunSyncState = { status: 'idle' };

export function RunSyncButton() {
  const [state, action] = useFormState<RunSyncState, FormData>(
    runUberSyncAction,
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
          {state.skipped
            ? ` · skipped ${state.skipped} (already imported or canceled)`
            : ''}
          {state.unmatched.length > 0 && (
            <>
              {' '}· unmatched riders:{' '}
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

export function ImportCsvButton() {
  const [state, action] = useFormState<ImportCsvState, FormData>(
    importUberCsvAction,
    csvIdle,
  );
  return (
    <form action={action} encType="multipart/form-data" className="space-y-2">
      <Field
        label="Trip activity report (CSV)"
        hint="Uber for Business admin → Reports → Trip activity → Download CSV."
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
          (already imported) · canceled rows dropped: {state.canceled}
          {state.projectAutoTagged > 0 && (
            <>
              {' '}· auto-tagged {state.projectAutoTagged} to projects via
              Expense Code / Memo match
            </>
          )}
          {state.unmatched.length > 0 && (
            <>
              {' '}· unmatched riders:{' '}
              <span className="font-mono">{state.unmatched.join(', ')}</span>
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
      {pending ? 'Importing…' : 'Import trips'}
    </Button>
  );
}

// ─── SFTP configuration + manual pull ─────────────────────────────────

const sftpIdle: ConfigureSftpState = { status: 'idle' };

/**
 * Form for the Uber for Business SFTP delivery channel. Admin pastes
 * the host + username + SSH private key Uber emailed after enabling
 * the integration. The private key is stored encrypted and never
 * round-trips back to the client; the input is a `<textarea>` because
 * PEM keys are multi-line.
 */
export function SftpConfigForm({
  initial,
}: {
  initial?: {
    host: string;
    port: number;
    username: string;
    remoteDir: string;
    filePattern: string | null;
  };
}) {
  const [state, action] = useFormState<ConfigureSftpState, FormData>(
    configureUberSftpAction,
    sftpIdle,
  );
  return (
    <form action={action} className="space-y-3">
      <Field label="Host" hint="From the Uber for Business setup email.">
        <Input
          name="host"
          required
          defaultValue={initial?.host ?? ''}
          autoComplete="off"
          placeholder="sftp.uberbusiness.com"
          className="font-mono"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Port">
          <Input
            name="port"
            type="number"
            min={1}
            max={65535}
            defaultValue={initial?.port ?? 22}
            className="font-mono"
          />
        </Field>
        <Field label="Username">
          <Input
            name="username"
            required
            defaultValue={initial?.username ?? ''}
            autoComplete="off"
            className="font-mono"
          />
        </Field>
      </div>
      <Field
        label="Private key (PEM)"
        hint="Paste the BEGIN/END PRIVATE KEY block in full. Stored encrypted."
      >
        <textarea
          name="privateKey"
          required
          autoComplete="off"
          rows={6}
          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;…&#10;-----END OPENSSH PRIVATE KEY-----"
          className="block w-full rounded-md border border-line bg-surface-elev px-2 py-1.5 font-mono text-xs text-ink"
        />
      </Field>
      <Field
        label="Passphrase"
        hint="Optional · only if the key is encrypted."
      >
        <Input
          name="passphrase"
          type="password"
          autoComplete="new-password"
          className="font-mono"
        />
      </Field>
      <Field
        label="Remote directory"
        hint="e.g. /outbound/ or /trips/ — wherever Uber drops the CSVs."
      >
        <Input
          name="remoteDir"
          required
          defaultValue={initial?.remoteDir ?? '/'}
          autoComplete="off"
          className="font-mono"
        />
      </Field>
      <Field
        label="Filename filter"
        hint="Case-insensitive substring. Default '.csv'. Use 'trips' to skip employee-roster files."
      >
        <Input
          name="filePattern"
          defaultValue={initial?.filePattern ?? ''}
          autoComplete="off"
          placeholder=".csv"
          className="font-mono"
        />
      </Field>
      <SftpConfigSubmit isEdit={Boolean(initial)} />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}
    </form>
  );
}

function SftpConfigSubmit({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending
        ? 'Saving…'
        : isEdit
          ? 'Update SFTP config'
          : 'Save SFTP config'}
    </Button>
  );
}

const sftpClearIdle: ClearSftpState = { status: 'idle' };

export function ClearSftpButton() {
  const [state, action] = useFormState<ClearSftpState, FormData>(
    clearUberSftpAction,
    sftpClearIdle,
  );
  return (
    <form
      action={action}
      className="inline-flex flex-wrap items-center gap-2"
    >
      <ClearSftpSubmit />
      {state.status === 'error' && (
        <span className="text-xs text-status-red">{state.message}</span>
      )}
      {state.status === 'success' && (
        <span className="text-xs text-status-green">Cleared.</span>
      )}
    </form>
  );
}

function ClearSftpSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending}>
      {pending ? 'Clearing…' : 'Clear SFTP config'}
    </Button>
  );
}

const sftpPullIdle: RunSftpPullState = { status: 'idle' };

export function RunSftpPullButton() {
  const [state, action] = useFormState<RunSftpPullState, FormData>(
    runUberSftpPullAction,
    sftpPullIdle,
  );
  return (
    <form action={action} className="space-y-2">
      <SftpPullSubmit />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">
          {state.filesImported > 0 ? (
            <>
              Imported {state.tripsImported} trip
              {state.tripsImported === 1 ? '' : 's'} from{' '}
              {state.filesImported} file{state.filesImported === 1 ? '' : 's'}.
            </>
          ) : (
            <>No new files (skipped {state.filesSkipped} already-imported).</>
          )}
          {state.filesFailed > 0 && (
            <>
              {' '}· {state.filesFailed} file{state.filesFailed === 1 ? '' : 's'}{' '}
              failed:{' '}
              <span className="font-mono">{state.failedFiles.join(', ')}</span>
            </>
          )}
          {state.tripsCanceled > 0 && (
            <> · {state.tripsCanceled} canceled rows dropped</>
          )}
          {state.unmatchedRiders.length > 0 && (
            <>
              {' '}· unmatched riders:{' '}
              <span className="font-mono">
                {state.unmatchedRiders.join(', ')}
              </span>
            </>
          )}
          .
        </p>
      )}
    </form>
  );
}

function SftpPullSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Pulling…' : 'Pull SFTP files now'}
    </Button>
  );
}
