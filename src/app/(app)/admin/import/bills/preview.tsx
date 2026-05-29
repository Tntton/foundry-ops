'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { commitBillsCsv, type CommitState } from './actions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { BillsPreview } from '@/server/imports/bills';

const initialState: CommitState = { status: 'idle' };

export function BillsPreviewView({
  preview,
  token,
}: {
  preview: BillsPreview;
  token: string;
}) {
  const [state, action] = useFormState(commitBillsCsv, initialState);
  const [mode, setMode] = useState<'skip_duplicates' | 'force_create'>('skip_duplicates');
  const hasUsable = preview.acceptedCount > 0;
  const errorCsvUrl = preview.rejectedCount > 0 ? buildRejectedCsvDataUri(preview) : null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-ink-3">
          <Link href="/admin/import" className="hover:underline">
            Data imports
          </Link>{' '}
          /{' '}
          <Link href="/admin/import/bills" className="hover:underline">
            Bills
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
        <Counter label="Total $ AUD" value={preview.totalAmountDollars.toFixed(2)} tone="blue" />
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
                download={`bills-rejects-${preview.fileName}`}
                className="font-medium underline"
              >
                Download rejected rows as CSV
              </a>
            </p>
          )}
        </div>
      )}

      {preview.duplicateCount > 0 && (
        <div className="rounded-md border border-line bg-surface-subtle px-4 py-3 text-sm">
          <p className="font-medium text-ink">Duplicate handling</p>
          <p className="mt-1 text-xs text-ink-3">
            {preview.duplicateCount} row(s) match an existing bill on (supplierName,
            supplierInvoiceNumber). Default is to skip; you can force create
            instead if you know these are genuinely different bills.
          </p>
          <div className="mt-2 flex gap-3 text-xs">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="mode-radio"
                checked={mode === 'skip_duplicates'}
                onChange={() => setMode('skip_duplicates')}
              />
              Skip duplicates (leave existing bills alone)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="mode-radio"
                checked={mode === 'force_create'}
                onChange={() => setMode('force_create')}
              />
              Force-create (insert anyway)
            </label>
          </div>
        </div>
      )}

      <Section title="Per-supplier summary">
        <SummaryTable
          cols={['Supplier', 'Match', 'Rows', '$ total']}
          rows={preview.perSupplier.map((s) => [
            s.supplierName,
            s.supplierMatched ? <Badge variant="green">matched</Badge> : <Badge variant="outline">new</Badge>,
            String(s.rowCount),
            s.totalDollars.toFixed(2),
          ])}
        />
      </Section>

      <Section title="Per-project summary">
        <SummaryTable
          cols={['Project code', 'Match', 'Rows', '$ total']}
          rows={preview.perProject.map((p) => [
            p.projectCode,
            p.matched ? <Badge variant="green">matched</Badge> : <Badge variant="destructive">no match</Badge>,
            String(p.rowCount),
            p.totalDollars.toFixed(2),
          ])}
          emptyHint="No rows had a projectCode — all will land as OPEX."
        />
      </Section>

      {preview.rejectedCount > 0 && (
        <Section title="Rejected rows">
          <div className="overflow-x-auto rounded-lg border border-line bg-card">
            <table className="w-full text-xs">
              <thead className="border-b border-line bg-surface-subtle">
                <tr>
                  <Th>#</Th>
                  <Th>Supplier</Th>
                  <Th>Invoice #</Th>
                  <Th>Issue date</Th>
                  <Th>Amount</Th>
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
                      <Td>{r.raw['suppliername'] ?? ''}</Td>
                      <Td className="font-mono">{r.raw['supplierinvoicenumber'] ?? ''}</Td>
                      <Td className="font-mono">{r.raw['issuedate'] ?? ''}</Td>
                      <Td className="font-mono">{r.raw['amounttotaldollars'] ?? ''}</Td>
                      <Td className="text-status-red">{r.rejectionReason}</Td>
                    </tr>
                  ))}
              </tbody>
            </table>
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
          <Link href="/admin/import/bills">Cancel</Link>
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
  value: number | string;
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

function SummaryTable({
  cols,
  rows,
  emptyHint,
}: {
  cols: string[];
  rows: Array<Array<React.ReactNode>>;
  emptyHint?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-xs text-ink-3">
        {emptyHint ?? 'No rows.'}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-card">
      <table className="w-full text-xs">
        <thead className="border-b border-line bg-surface-subtle">
          <tr>
            {cols.map((c, i) => (
              <Th key={i} align={i >= 2 ? 'right' : undefined}>
                {c}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-line last:border-b-0">
              {row.map((cell, ci) => (
                <Td key={ci} align={ci >= 2 ? 'right' : undefined}>
                  {cell}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function buildRejectedCsvDataUri(preview: BillsPreview): string {
  const headers = ['rowIndex', 'supplierName', 'invoiceNumber', 'issueDate', 'amount', 'reason'];
  const lines = [headers.join(',')];
  for (const r of preview.rows) {
    if (r.rejectionReason === null) continue;
    const cells = [
      String(r.rowIndex),
      r.raw['suppliername'] ?? '',
      r.raw['supplierinvoicenumber'] ?? '',
      r.raw['issuedate'] ?? '',
      r.raw['amounttotaldollars'] ?? '',
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
