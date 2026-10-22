'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { runReportWorkbooksNowAction, type RunWorkbooksState } from './actions';
import { Button } from '@/components/ui/button';

const idle: RunWorkbooksState = { status: 'idle' };

/**
 * "Regenerate report workbooks" — fires the same pipeline as the nightly
 * cron, republishing every themed reporting workbook (Finance, …) to the
 * SharePoint Reports folder. Per-workbook status shows inline.
 */
export function RunWorkbooksNowButton() {
  const [state, action] = useFormState<RunWorkbooksState, FormData>(
    runReportWorkbooksNowAction,
    idle,
  );
  return (
    <form action={action} className="space-y-3">
      <Submit />
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-xs text-status-red">
          {state.message}
        </div>
      )}
      {state.status === 'success' && (
        <ul className="space-y-1 rounded-md border border-line bg-card px-3 py-2 text-xs">
          {state.results.map((r) => (
            <li key={r.name} className="flex items-center gap-2">
              <span className={r.ok ? 'text-status-green' : 'text-status-red'}>
                {r.ok ? '✓' : '✗'}
              </span>
              <span className="font-medium text-ink">{r.name}.xlsx</span>
              {r.uploadSkipped ? (
                <span className="text-status-amber">
                  generated — SharePoint upload skipped (Graph not configured)
                </span>
              ) : r.webUrl ? (
                <a
                  href={r.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand underline"
                >
                  Open in SharePoint ↗
                </a>
              ) : (
                <span className="text-ink-3">no link</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Regenerating…' : '↻ Regenerate report workbooks'}
    </Button>
  );
}
