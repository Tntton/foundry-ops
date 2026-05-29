'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { commitPersonnelCsv, type CommitState } from './actions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { PersonnelPreview } from '@/server/imports/personnel';

const initialState: CommitState = { status: 'idle' };

export function PersonnelPreviewView({
  preview,
  token,
}: {
  preview: PersonnelPreview;
  token: string;
}) {
  const [state, action] = useFormState(commitPersonnelCsv, initialState);
  const canCommit =
    preview.errorCount === 0 && preview.duplicateEmails.length === 0 && preview.topLevelErrors.length === 0;
  const errorCsvUrl = canCommit ? null : buildErrorsCsvDataUri(preview);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-ink-3">
          <Link href="/admin/import" className="hover:underline">
            Data imports
          </Link>{' '}
          /{' '}
          <Link href="/admin/import/personnel" className="hover:underline">
            Personnel
          </Link>{' '}
          / Preview
        </p>
        <h1 className="mt-1 text-xl font-semibold text-ink">
          Preview — {preview.fileName}
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Counter label="Rows" value={preview.totalRows} />
        <Counter label="New" value={preview.newCount} tone="green" />
        <Counter label="Update" value={preview.updateCount} tone="blue" />
        <Counter label="Errors" value={preview.errorCount} tone={preview.errorCount > 0 ? 'red' : 'neutral'} />
      </div>

      {!canCommit && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-4 py-3 text-sm text-status-red">
          <p className="font-medium">Can&apos;t commit yet.</p>
          {preview.duplicateEmails.length > 0 && (
            <p className="mt-1">
              Duplicate emails in the file: {preview.duplicateEmails.join(', ')}. Fix and re-upload.
            </p>
          )}
          {preview.errorCount > 0 && (
            <p className="mt-1">{preview.errorCount} row(s) have validation errors — see table below.</p>
          )}
          {errorCsvUrl && (
            <p className="mt-2">
              <a
                href={errorCsvUrl}
                download={`personnel-errors-${preview.fileName}`}
                className="font-medium underline"
              >
                Download errors as CSV
              </a>
            </p>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="border-b border-line bg-surface-subtle">
            <tr>
              <Th>#</Th>
              <Th>Status</Th>
              <Th>Email</Th>
              <Th>Name</Th>
              <Th>Band / Level</Th>
              <Th>Employment</Th>
              <Th>Rate</Th>
              <Th>Changes / Errors</Th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r) => (
              <tr key={r.rowIndex} className="border-b border-line last:border-b-0">
                <Td className="font-mono text-ink-3">{r.rowIndex}</Td>
                <Td>
                  {r.action === 'new' && <Badge variant="default">new</Badge>}
                  {r.action === 'update' && (
                    <Badge variant="secondary">update</Badge>
                  )}
                  {r.action === 'error' && (
                    <Badge variant="destructive">error</Badge>
                  )}
                </Td>
                <Td className="font-mono">{r.raw['email'] ?? '—'}</Td>
                <Td>
                  {(r.raw['firstname'] ?? '') + ' ' + (r.raw['lastname'] ?? '')}
                </Td>
                <Td className="font-mono">
                  {r.raw['band'] ?? '—'} · {r.raw['level'] ?? '—'}
                </Td>
                <Td>{r.raw['employment'] ?? '—'}</Td>
                <Td className="font-mono">
                  ${r.raw['ratedollars'] ?? '—'}/{r.raw['rateunit'] ?? '—'}
                </Td>
                <Td>
                  {r.errors.length > 0 && (
                    <ul className="space-y-0.5 text-status-red">
                      {r.errors.map((e, i) => (
                        <li key={i}>· {e}</li>
                      ))}
                    </ul>
                  )}
                  {r.action === 'update' && r.diff.length > 0 && (
                    <ul className="space-y-0.5 text-ink-3">
                      {r.diff.slice(0, 5).map((d, i) => (
                        <li key={i}>
                          <span className="font-mono">{d.field}</span>:{' '}
                          <span className="text-ink-4 line-through">{d.before || '—'}</span>{' '}
                          → <span className="text-ink">{d.after || '—'}</span>
                        </li>
                      ))}
                      {r.diff.length > 5 && (
                        <li className="text-ink-4">+ {r.diff.length - 5} more</li>
                      )}
                    </ul>
                  )}
                  {r.action === 'update' && r.diff.length === 0 && (
                    <span className="text-ink-4">no changes</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}

      <form action={action} className="flex items-center justify-end gap-2">
        <input type="hidden" name="token" value={token} />
        <Button type="button" asChild variant="ghost">
          <Link href="/admin/import/personnel">Cancel</Link>
        </Button>
        <CommitButton disabled={!canCommit} />
      </form>
    </div>
  );
}

function CommitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? 'Committing…' : 'Commit import'}
    </Button>
  );
}

function Counter({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'green' | 'blue' | 'red';
}) {
  const toneClass =
    tone === 'green'
      ? 'text-status-green'
      : tone === 'blue'
        ? 'text-status-blue'
        : tone === 'red'
          ? 'text-status-red'
          : 'text-ink';
  return (
    <div className="rounded-md border border-line bg-card p-3">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-ink-3">
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}

function buildErrorsCsvDataUri(preview: PersonnelPreview): string {
  const headers = ['rowIndex', 'email', 'errors'];
  const lines = [headers.join(',')];
  for (const r of preview.rows) {
    if (r.errors.length === 0) continue;
    const cells = [
      String(r.rowIndex),
      r.raw['email'] ?? '',
      r.errors.join(' · '),
    ].map(csvCell);
    lines.push(cells.join(','));
  }
  const body = lines.join('\r\n') + '\r\n';
  return 'data:text/csv;charset=utf-8,' + encodeURIComponent(body);
}

function csvCell(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
