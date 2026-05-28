'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import {
  patchIntakeBill,
  approveIntakeBill,
  type IntakeActionState,
} from './actions';
import type { IntakeBill, IntakeFieldConfidence } from '@/server/intake';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ProjectOption = { id: string; code: string; name: string };

const CATEGORY_OPTIONS = [
  'Experts (p/h)',
  'Experts (project)',
  'Subcontractor — services',
  'Subcontractor — research',
  'Software / SaaS',
  'Travel',
  'Office',
  'Marketing / BD',
  'Legal / professional',
  'OPEX — uncategorised',
];

function ConfidenceTag({ field }: { field: IntakeFieldConfidence }) {
  if (field.state === 'high')
    return (
      <span className="rounded-md bg-status-green-soft px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-status-green">
        {field.pct}%
      </span>
    );
  if (field.state === 'medium')
    return (
      <span className="rounded-md bg-status-amber-soft px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-status-amber">
        {field.pct}%
      </span>
    );
  if (field.state === 'inferred')
    return (
      <span
        title={field.note}
        className="rounded-md bg-status-amber-soft px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-status-amber"
      >
        {field.pct}% · INFERRED
      </span>
    );
  if (field.state === 'auto_matched')
    return (
      <span className="rounded-md bg-status-green-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-green">
        Auto-matched
      </span>
    );
  if (field.state === 'suggested')
    return (
      <span className="rounded-md bg-surface-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-3">
        Suggested
      </span>
    );
  return (
    <span className="rounded-md bg-status-red-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-red">
      Not found
    </span>
  );
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function IntakeFieldEditor({
  bill,
  projects,
  nextId,
}: {
  bill: IntakeBill;
  projects: ProjectOption[];
  nextId: string | null;
}) {
  const patchBound = patchIntakeBill.bind(null, bill.id);
  const approveBound = approveIntakeBill.bind(null, bill.id);
  const [patchState, patchAction] = useFormState<IntakeActionState, FormData>(
    patchBound,
    { status: 'idle' },
  );
  const [approveState, approveAction] = useFormState<IntakeActionState, FormData>(
    approveBound,
    { status: 'idle' },
  );

  const [supplier, setSupplier] = useState(bill.supplierName ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState(bill.supplierInvoiceNumber ?? '');
  const [issueDate, setIssueDate] = useState(toIso(bill.issueDate));
  const [dueDate, setDueDate] = useState(toIso(bill.dueDate));
  const [amount, setAmount] = useState(((bill.amountTotalCents - bill.gstCents) / 100).toFixed(2));
  const [gst, setGst] = useState((bill.gstCents / 100).toFixed(2));
  const [projectId, setProjectId] = useState(bill.projectId ?? '');
  const [category, setCategory] = useState(bill.category);

  // The two server actions both consume the same form fields — render one
  // form and submit to the right action via the formAction prop on the
  // submit button. Keeps the UI snappy and prevents double-edit drift.
  return (
    <form className="space-y-3">
      <FieldRow label="Supplier" confidence={bill.fields.supplier}>
        <Input
          name="supplierName"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="Hawksparks Pty Ltd"
        />
      </FieldRow>
      <FieldRow label="Invoice #" confidence={bill.fields.invoiceNumber}>
        <Input
          name="supplierInvoiceNumber"
          value={invoiceNumber}
          onChange={(e) => setInvoiceNumber(e.target.value)}
          placeholder="HS-2041"
          className="font-mono"
        />
      </FieldRow>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Invoice date" confidence={bill.fields.issueDate}>
          <Input
            name="issueDate"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
        </FieldRow>
        <FieldRow label="Due date" confidence={bill.fields.dueDate}>
          <Input
            name="dueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </FieldRow>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="Amount (ex GST)" confidence={bill.fields.amount}>
          <Input
            name="amountExGstDollars"
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tabular-nums"
          />
        </FieldRow>
        <FieldRow label="GST" confidence={bill.fields.gst}>
          <Input
            name="gstDollars"
            type="number"
            step="0.01"
            min="0"
            value={gst}
            onChange={(e) => setGst(e.target.value)}
            placeholder="add if applicable"
            className="tabular-nums"
          />
        </FieldRow>
      </div>
      {/* The action expects amountTotalDollars (inc-GST). Compute it from the
          two visible fields so the UI stays additive. Use `|| 0` to coerce
          NaN (empty input) to 0, otherwise the hidden field serialises
          "NaN" and Zod's coerce rejects it as "Number must be greater than
          or equal to 0". */}
      <input
        type="hidden"
        name="amountTotalDollars"
        value={((parseFloat(amount) || 0) + (parseFloat(gst) || 0)).toFixed(2)}
      />
      {bill.attributedToName && (
        <div className="flex items-center justify-between rounded-md border border-line bg-surface-subtle/40 px-3 py-2 text-xs">
          <span className="text-ink-3">Traveller (cost attributed to)</span>
          <span className="font-medium text-ink-2">
            {bill.attributedToName}
            <span className="ml-2 text-[10px] text-ink-3">
              · firm paid via AMEX — not for reimbursement
            </span>
          </span>
        </div>
      )}
      <FieldRow label="Match to project" confidence={bill.fields.project}>
        <select
          name="projectId"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
        >
          <option value="">— None (OPEX) —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow label="Expense category" confidence={bill.fields.category}>
        <select
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="flex h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
        >
          {[...new Set([category, ...CATEGORY_OPTIONS])].filter(Boolean).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </FieldRow>

      {(patchState.status === 'error' || approveState.status === 'error') && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-xs text-status-red">
          {patchState.status === 'error'
            ? patchState.message
            : approveState.status === 'error'
              ? approveState.message
              : null}
        </div>
      )}
      {patchState.status === 'success' && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-xs text-status-green">
          {patchState.message}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <SkipButton nextId={nextId} />
        <SaveDraftButton formAction={patchAction} />
        <ApproveButton formAction={approveAction} />
      </div>
    </form>
  );
}

function FieldRow({
  label,
  confidence,
  children,
}: {
  label: string;
  confidence: IntakeFieldConfidence;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-line bg-card px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
          {label}
        </span>
        <ConfidenceTag field={confidence} />
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function SaveDraftButton({
  formAction,
}: {
  formAction: (formData: FormData) => void;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      formAction={formAction as unknown as string}
      variant="outline"
      size="sm"
      disabled={pending}
    >
      {pending ? 'Saving…' : 'Save draft'}
    </Button>
  );
}

function ApproveButton({
  formAction,
}: {
  formAction: (formData: FormData) => void;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      formAction={formAction as unknown as string}
      size="sm"
      disabled={pending}
    >
      {pending ? 'Posting…' : 'Approve & post →'}
    </Button>
  );
}

function SkipButton({ nextId }: { nextId: string | null }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => {
        if (nextId) {
          window.location.href = `/bills/intake?id=${nextId}`;
        } else {
          window.location.href = '/bills/intake';
        }
      }}
    >
      Skip
    </Button>
  );
}
