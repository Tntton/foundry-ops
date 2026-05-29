'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { commitTimesheetCsv, type CommitState } from './actions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { TimesheetPreview } from '@/server/imports/timesheets';

const initialState: CommitState = { status: 'idle' };

export function TimesheetPreviewView({
  preview,
  token,
}: {
  preview: TimesheetPreview;
  token: string;
}) {
  const [state, action] = useFormState(commitTimesheetCsv, initialState);
  const [mode, setMode] = useState<'skip_duplicates' | 'overwrite_duplicates'>('skip_duplicates');
  const hasUsable = preview.acceptedCount > 0;
  const errorCsvUrl =
    preview.rejectedCount > 0 ? buildRejectedCsvDataUri(preview) : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-ink-3">
          <Link href="/admin/import" className="hover:underline">
            Bulk import
          </Link>{' '}
          /{' '}
          <Link href="/admin/import/timesheets" className="hover:underline">
            Timesheets
          </Link>{' '}
          / Preview
        </p>
        <h1 className="mt-1 text-xl font-semibold text-ink">
          Preview — {preview.fileName}
        </h1>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Counter label="Rows" value={preview.totalRows} />
        <Counter label="Accepted" value={preview.acceptedCount} tone="green" />
        <Counter label="Rejected" value={preview.rejectedCount} tone={preview.rejectedCount > 0 ? 'red' : 'neutral'} />
        <Counter label="Duplicates" value={preview.duplicateCount} tone={preview.duplicateCount > 0 ? 'amber' : 'neutral'} />
        <Counter label="Total hours" value={preview.totalHours} tone="blue" />
      </div>

      {preview.rejectedCount > 0 && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-4 py-3 text-sm text-status-amber">
          <p className="font-medium">
            {preview.rejectedCount} row(s) will be skipped at commit.
          </p>
          {errorCsvUrl && (
            <p className="mt-1">
              <a
                href={errorCsvUrl}
                download={`timesheet-rejects-${preview.fileName}`}
                className="font-medium underline"
              >
                Download rejected rows as CSV
              </a>{' '}
              to fix and re-upload.
            </p>
          )}
        </div>
      )}

      {preview.duplicateCount > 0 && (
        <div className="rounded-md border border-line bg-surface-subtle px-4 py-3 text-sm">
          <p className="font-medium text-ink">Duplicate handling</p>
          <p className="mt-1 text-xs text-ink-3">
            {preview.duplicateCount} row(s) collide with existing entries on
            (person, project, date). Default is to skip them.
          </p>
          <div className="mt-2 flex gap-3 text-xs">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="mode-radio"
                checked={mode === 'skip_duplicates'}
                onChange={() => setMode('skip_duplicates')}
              />
              Skip duplicates (leave existing entries alone)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="mode-radio"
                checked={mode === 'overwrite_duplicates'}
                onChange={() => setMode('overwrite_duplicates')}
              />
              Overwrite existing entries
            </label>
          </div>
        </div>
      )}

      <Section title="Per-person summary">
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full text-xs">
            <thead className="border-b border-line bg-surface-subtle">
              <tr>
                <Th>Email</Th>
                <Th>Match</Th>
                <Th align="right">Rows</Th>
                <Th align="right">Hours</Th>
              </tr>
            </thead>
            <tbody>
              {preview.perPerson.map((p) => (
                <tr key={p.personEmail} className="border-b border-line last:border-b-0">
                  <Td className="font-mono">{p.personEmail}</Td>
                  <Td>
                    {p.matched ? (
                      <Badge variant="green">matched</Badge>
                    ) : (
                      <Badge variant="destructive">no match</Badge>
                    )}
                  </Td>
                  <Td align="right">{p.rowCount}</Td>
                  <Td align="right">{p.totalHours.toFixed(2)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Per-project summary">
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full text-xs">
            <thead className="border-b border-line bg-surface-subtle">
              <tr>
                <Th>Project code</Th>
                <Th>Match</Th>
                <Th align="right">Rows</Th>
                <Th align="right">Hours</Th>
              </tr>
            </thead>
            <tbody>
              {preview.perProject.map((p) => (
                <tr key={p.projectCode} className="border-b border-line last:border-b-0">
                  <Td className="font-mono">{p.projectCode}</Td>
                  <Td>
                    {p.matched ? (
                      <Badge variant="green">matched</Badge>
                    ) : (
                      <Badge variant="destructive">no match</Badge>
                    )}
                  </Td>
                  <Td align="right">{p.rowCount}</Td>
                  <Td align="right">{p.totalHours.toFixed(2)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {preview.rejectedCount > 0 && (
        <Section title="Rejected rows">
          <div className="overflow-x-auto rounded-lg border border-line bg-card">
            <table className="w-full text-xs">
              <thead className="border-b border-line bg-surface-subtle">
                <tr>
                  <Th>#</Th>
                  <Th>Email</Th>
                  <Th>Project</Th>
                  <Th>Date</Th>
                  <Th>Hours</Th>
                  <Th>Reason</Th>
                </tr>
              </thead>
              <tbody>
                {preview.rows
                  .filter((r) => r.rejectionReason !== null)
                  .slice(0, 100)
                  .map((r) => (
                    <tr key={r.rowIndex} className="border-b border-line last:border-b-0">
                      <Td className="font-mono">{r.rowIndex}</Td>
                      <Td className="font-mono">{r.raw['personemail'] ?? ''}</Td>
                      <Td className="font-mono">{r.raw['projectcode'] ?? ''}</Td>
                      <Td className="font-mono">{r.raw['date'] ?? ''}</Td>
                      <Td className="font-mono">{r.raw['hours'] ?? ''}</Td>
                      <Td className="text-status-red">{r.rejectionReason}</Td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {preview.rejectedCount > 100 && (
              <p className="border-t border-line bg-surface-subtle px-3 py-2 text-xs text-ink-3">
                Showing first 100 of {preview.rejectedCount} rejected — download the
                CSV above for the full list.
              </p>
            )}
          </div>
        </Section>
      )}

      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}

      <form action={action} className="flex items-center justify-end gap-2">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="mode" value={mode} />
        <Button type="button" asChild variant="ghost">
          <Link href="/admin/import/timesheets">Cancel</Link>
        </Button>
        <CommitButton disabled={!hasUsable} />
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
  tone?: 'neutral' | 'green' | 'blue' | 'red' | 'amber';
}) {
  const toneClass =
    tone === 'green'
      ? 'text-status-green'
      : tone === 'blue'
        ? 'text-status-blue'
        : tone === 'red'
          ? 'text-status-red'
          : tone === 'amber'
            ? 'text-status-amber'
            : 'text-ink';
  return (
    <div className="rounded-md border border-line bg-card p-3">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h2>
      {children}
    </section>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: 'right';
}) {
  return (
    <th
      className={`px-3 py-2 font-semibold uppercase tracking-wide text-ink-3 ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
  align,
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'right';
}) {
  return (
    <td
      className={`px-3 py-2 align-top ${align === 'right' ? 'text-right' : ''} ${className}`}
    >
      {children}
    </td>
  );
}

function buildRejectedCsvDataUri(preview: TimesheetPreview): string {
  const headers = ['rowIndex', 'personEmail', 'projectCode', 'date', 'hours', 'reason'];
  const lines = [headers.join(',')];
  for (const r of preview.rows) {
    if (r.rejectionReason === null) continue;
    const cells = [
      String(r.rowIndex),
      r.raw['personemail'] ?? '',
      r.raw['projectcode'] ?? '',
      r.raw['date'] ?? '',
      r.raw['hours'] ?? '',
      r.rejectionReason,
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
