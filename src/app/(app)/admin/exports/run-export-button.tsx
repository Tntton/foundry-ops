'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { runDataExportNowAction, type RunExportState } from './actions';
import { Button } from '@/components/ui/button';

const idle: RunExportState = { status: 'idle' };

/**
 * "Run export now" button — fires the same pipeline as the nightly
 * cron but synchronously from the admin page. State is reported
 * inline below the button so the operator gets immediate feedback
 * (filename + size + SharePoint link) instead of having to refresh
 * the audit log.
 */
export function RunExportNowButton() {
  const [state, action] = useFormState<RunExportState, FormData>(
    runDataExportNowAction,
    idle,
  );
  return (
    <form action={action} className="space-y-3">
      <RunExportSubmit />
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-xs text-status-red">
          {state.message}
        </div>
      )}
      {state.status === 'success' && (
        <div className="space-y-2 rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-xs text-status-green">
          <div>
            <strong>{state.filename}</strong>{' '}
            <span className="text-ink-3">
              ({(state.sizeBytes / 1024).toFixed(1)} KB ·{' '}
              {Object.keys(state.tableCounts).length} tables)
            </span>
          </div>
          {state.uploadSkipped ? (
            <div className="text-status-amber">
              Snapshot generated but SharePoint upload was skipped —
              Graph not configured. Set{' '}
              <code className="font-mono">SHAREPOINT_SITE_URL</code>{' '}
              and{' '}
              <code className="font-mono">SHAREPOINT_ADMIN_ROOT</code>{' '}
              env vars to land the ZIP in M365.
            </div>
          ) : state.webUrl ? (
            <div>
              Uploaded to SharePoint —{' '}
              <a
                href={state.webUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Open in SharePoint →
              </a>
            </div>
          ) : null}
        </div>
      )}
    </form>
  );
}

function RunExportSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Generating + uploading…' : '↓ Run export now'}
    </Button>
  );
}
