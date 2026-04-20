'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useMemo, useState } from 'react';
import { createInvoice, type NewInvoiceState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ProjectOption = {
  id: string;
  code: string;
  name: string;
  clientCode: string;
  clientName: string;
};

type Line = { label: string; amountDollars: string };

export function NewInvoiceForm({
  projects,
  defaultProjectId,
}: {
  projects: ProjectOption[];
  defaultProjectId?: string;
}) {
  const [state, action] = useFormState<NewInvoiceState, FormData>(createInvoice, {
    status: 'idle',
  });
  const [projectId, setProjectId] = useState(defaultProjectId ?? '');
  const [lines, setLines] = useState<Line[]>([{ label: '', amountDollars: '0' }]);

  const project = projects.find((p) => p.id === projectId);

  const totals = useMemo(() => {
    const ex = lines.reduce((s, l) => s + (Number(l.amountDollars) || 0), 0);
    const gst = Math.round(ex * 10) / 100;
    const total = ex + gst;
    return { ex, gst, total };
  }, [lines]);

  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { label: '', amountDollars: '0' }]);
  }
  function removeLine(i: number) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  return (
    <form action={action} className="space-y-6">
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}

      <p className="text-xs text-ink-3">
        Fields marked with <span className="text-status-red">*</span> are required.
      </p>

      <Section title="Project">
        <label className="block text-xs font-medium text-ink-3">
          Project<span className="ml-1 text-status-red">*</span>
        </label>
        <select
          name="projectId"
          required
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">— Choose project —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name} · {p.clientCode} {p.clientName}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Dates">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-ink-3">
              Issue date<span className="ml-1 text-status-red">*</span>
            </label>
            <Input name="issueDate" type="date" required defaultValue={today} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-ink-3">
              Due date<span className="ml-1 text-status-red">*</span>
              <span className="ml-2 text-ink-4">· defaults to +30 days</span>
            </label>
            <Input name="dueDate" type="date" required defaultValue={in30} />
          </div>
        </div>
      </Section>

      <Section title="Line items">
        <p className="text-xs text-ink-3">
          At least one line item<span className="ml-1 text-status-red">*</span> with label and amount.
        </p>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                name="lineLabel"
                value={l.label}
                onChange={(e) => updateLine(i, { label: e.target.value })}
                placeholder="Milestone 1 — Kickoff"
                className="flex-1"
                required
              />
              <Input
                name="lineAmount"
                type="number"
                min="0"
                step="0.01"
                value={l.amountDollars}
                onChange={(e) => updateLine(i, { amountDollars: e.target.value })}
                className="w-40 text-right"
                required
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(i)}>
                ✕
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            + Add line
          </Button>
        </div>

        <div className="mt-4 ml-auto grid max-w-xs grid-cols-2 gap-y-1 text-sm">
          <span className="text-ink-3">Subtotal (ex GST)</span>
          <span className="text-right tabular-nums text-ink-2">{formatMoney(totals.ex)}</span>
          <span className="text-ink-3">GST (10%)</span>
          <span className="text-right tabular-nums text-ink-2">{formatMoney(totals.gst)}</span>
          <span className="text-base font-semibold text-ink">Total</span>
          <span className="text-right text-base font-semibold tabular-nums text-ink">
            {formatMoney(totals.total)}
          </span>
        </div>
      </Section>

      {project && (
        <p className="text-xs text-ink-3">
          Invoice number will auto-generate (e.g. {project.code}-INV-01).
          {totals.total > 20000
            ? ' Total > $20k → Super Admin approval required.'
            : ' Total ≤ $20k → owning Partner can approve.'}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" asChild variant="ghost">
          <a href="/invoices">Cancel</a>
        </Button>
        <ActionButton intent="draft" label="Save as draft" variant="outline" />
        <ActionButton intent="submit" label="Save + submit for approval" variant="default" />
      </div>
    </form>
  );
}

function formatMoney(dollars: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(dollars);
}

function ActionButton({
  intent,
  label,
  variant,
}: {
  intent: 'draft' | 'submit';
  label: string;
  variant: 'default' | 'outline';
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" name="intent" value={intent} variant={variant} disabled={pending}>
      {pending ? '…' : label}
    </Button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-line bg-card p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h2>
      {children}
    </section>
  );
}
