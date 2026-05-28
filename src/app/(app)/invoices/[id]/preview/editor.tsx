'use client';

import { useState, useTransition } from 'react';
import {
  saveInvoicePreview,
  type PreviewSaveState,
} from './actions';
import { Button } from '@/components/ui/button';

/**
 * Right-rail editor for the template-only fields on the invoice preview.
 * Saves persist via `saveInvoicePreview` and the page revalidates so
 * the rendered preview reflects edits without a full reload.
 */
export function InvoicePreviewEditor({
  invoiceId,
  canEdit,
  statusLabel,
  initial,
  primaryLineExists,
}: {
  invoiceId: string;
  canEdit: boolean;
  statusLabel: string;
  initial: {
    purchaseOrderRef: string | null;
    forSubject: string | null;
    attentionTo: string | null;
    primaryLineLabel: string;
  };
  primaryLineExists: boolean;
}) {
  const [purchaseOrderRef, setPo] = useState(initial.purchaseOrderRef ?? '');
  const [forSubject, setForSubject] = useState(initial.forSubject ?? '');
  const [attentionTo, setAttentionTo] = useState(initial.attentionTo ?? '');
  const [primaryLineLabel, setPrimaryLineLabel] = useState(
    initial.primaryLineLabel,
  );
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<PreviewSaveState>({ status: 'idle' });

  function save() {
    setState({ status: 'idle' });
    const fd = new FormData();
    fd.set('purchaseOrderRef', purchaseOrderRef);
    fd.set('forSubject', forSubject);
    fd.set('attentionTo', attentionTo);
    fd.set('primaryLineLabel', primaryLineLabel);
    startTransition(async () => {
      const result = await saveInvoicePreview(invoiceId, state, fd);
      setState(result);
    });
  }

  if (!canEdit) {
    return (
      <div className="rounded-lg border border-line bg-card p-4 text-xs text-ink-3">
        <p className="font-semibold text-ink-2">Final-form preview</p>
        <p className="mt-1">
          Template fields are locked once the invoice moves past{' '}
          <span className="font-mono">{statusLabel}</span>. Use the
          back-link to revert to draft if you need to amend wording, or
          download the current version as PDF.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-ink">Template fields</h3>
        <p className="text-[11px] text-ink-3">
          Final tweaks before generating the PDF. Doesn&apos;t change
          totals — those flow through the regular invoice approval.
        </p>
      </div>
      <div className="space-y-2">
        <Field label="PO reference">
          <input
            type="text"
            value={purchaseOrderRef}
            onChange={(e) => setPo(e.target.value)}
            placeholder="optional"
            className="h-8 w-full rounded border border-line bg-surface-elev px-2 text-xs text-ink focus:border-brand"
          />
        </Field>
        <Field label="FOR subject">
          <input
            type="text"
            value={forSubject}
            onChange={(e) => setForSubject(e.target.value)}
            placeholder="Advisory services"
            className="h-8 w-full rounded border border-line bg-surface-elev px-2 text-xs text-ink focus:border-brand"
          />
        </Field>
        <Field label="Attention (client contact)">
          <input
            type="text"
            value={attentionTo}
            onChange={(e) => setAttentionTo(e.target.value)}
            placeholder="defaults to Client.contactName"
            className="h-8 w-full rounded border border-line bg-surface-elev px-2 text-xs text-ink focus:border-brand"
          />
        </Field>
        {primaryLineExists && (
          <Field label="Primary description">
            <textarea
              value={primaryLineLabel}
              onChange={(e) => setPrimaryLineLabel(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="Project description, scope, payment terms…"
              className="w-full rounded border border-line bg-surface-elev p-2 text-xs text-ink focus:border-brand"
            />
          </Field>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {state.status === 'error' && (
          <span className="mr-auto text-xs text-status-red">
            {state.message}
          </span>
        )}
        {state.status === 'success' && (
          <span className="mr-auto text-xs text-status-green">
            Saved · preview updated.
          </span>
        )}
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-ink-3">
      <span className="font-medium uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}
