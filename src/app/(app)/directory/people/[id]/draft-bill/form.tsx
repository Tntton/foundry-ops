'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { generateDraftBillFromHours, type DraftBillState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function DraftBillForm({
  personId,
  defaultIssueDate,
  defaultDueDate,
  projectCount,
}: {
  personId: string;
  defaultIssueDate: string;
  defaultDueDate: string;
  projectCount: number;
}) {
  const bound = generateDraftBillFromHours.bind(null, personId);
  const [state, action] = useFormState<DraftBillState, FormData>(bound, {
    status: 'idle',
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bill metadata</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          {state.status === 'error' && (
            <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
              {state.message}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Contractor invoice #" hint="Optional — fill once they send their PDF">
              <Input
                name="contractorInvoiceNumber"
                placeholder="INV-2026-042"
                className="font-mono"
              />
            </Field>
            <Field label="Attachment URL (SharePoint)" hint="Optional — link to PDF">
              <Input
                name="attachmentSharepointUrl"
                placeholder="https://foundryhealth.sharepoint.com/..."
              />
            </Field>
            <Field label="Issue date" required>
              <Input name="issueDate" type="date" defaultValue={defaultIssueDate} required />
            </Field>
            <Field label="Due date" required>
              <Input name="dueDate" type="date" defaultValue={defaultDueDate} required />
            </Field>
          </div>
          <Field label="Notes" hint="Optional — visible on the audit trail">
            <textarea
              name="notes"
              rows={2}
              placeholder="e.g. monthly draw, billing batch reference"
              className="w-full rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink"
            />
          </Field>
          <p className="text-xs text-ink-3">
            Will create {projectCount} {projectCount === 1 ? 'bill' : 'bills'} (one per
            project) and mark the matching approved timesheet entries as billed.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" asChild variant="ghost">
              <a href={`/directory/people/${personId}`}>Cancel</a>
            </Button>
            <SubmitBtn />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Creating…' : 'Create draft bill'}
    </Button>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-ink-3">
        {label}
        {required && <span className="ml-1 text-status-red">*</span>}
        {hint && <span className="ml-2 text-ink-4">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}
