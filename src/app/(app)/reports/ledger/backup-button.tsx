'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { runLedgerBackupNowAction, type LedgerBackupState } from './actions';

const idle: LedgerBackupState = { status: 'idle' };

/**
 * "Back up to 365 now" — fires the same pipeline as the nightly cron,
 * publishing the current ledger workbook to SharePoint. Feedback shows
 * inline so the operator sees the row count + SharePoint link.
 */
export function LedgerBackupButton() {
  const [state, action] = useFormState<LedgerBackupState, FormData>(
    runLedgerBackupNowAction,
    idle,
  );
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Submit />
      {state.status === 'error' && (
        <span className="text-xs text-status-red">{state.message}</span>
      )}
      {state.status === 'success' &&
        (state.uploadSkipped ? (
          <span className="text-xs text-status-amber">
            {state.rowCount} rows — SharePoint upload skipped (Graph not
            configured).
          </span>
        ) : (
          <span className="text-xs text-status-green">
            {state.rowCount} rows backed up
            {state.webUrl ? (
              <>
                {' — '}
                <a
                  href={state.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Open in SharePoint ↗
                </a>
              </>
            ) : null}
          </span>
        ))}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink disabled:opacity-60"
    >
      {pending ? 'Backing up…' : '↥ Back up to 365'}
    </button>
  );
}
