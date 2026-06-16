'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { decideApproval, type DecisionState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type ApprovalProjectOption = {
  id: string;
  code: string;
  name: string;
};

export type ApprovalPersonOption = {
  id: string;
  firstName: string;
  lastName: string;
};

export type ApprovalCategoryOption = {
  value: string;
  label: string;
};

/**
 * Approval decision form. For any allocation-bearing subject (expense
 * OR bill) + admin viewer, surfaces three override pickers so admin
 * can re-allocate the line at the moment of approval:
 *   - **Project** — re-tag to a different project / OPEX bucket
 *   - **Associated user** — bills only, the cost-attributed person
 *     (e.g. the traveller on a Navan-imported flight)
 *   - **Cost type** (category) — re-classify the GL bucket so the
 *     Xero push lands in the right account
 *
 * Overrides only fire when decision === 'approved' AND the picker
 * value moved. Rejecting leaves the original allocation intact for
 * re-submission. For Navan-imported bills where the trip name didn't
 * auto-tag a project, this is where allocation actually happens.
 */
export function DecisionForm({
  approvalId,
  /** When the approval subject carries an allocation (expense OR
   *  bill), pass the current project / person / category so the
   *  override pickers can show the in-progress values. Renamed from
   *  `projectContext` — same intent, broader scope. */
  allocationContext,
}: {
  approvalId: string;
  allocationContext?: {
    canOverrideAllocation: boolean;
    subjectType: 'expense' | 'bill';
    currentProjectId: string | null;
    /** Current project's code + name. Used to pin a "(current)"
     *  entry on the picker when the row is tagged to a project
     *  filtered out of the visible options (HIDDEN_PICKER_BUCKET_CODES). */
    currentProjectCode?: string | null;
    currentProjectName?: string | null;
    currentCategory: string | null;
    /** Bills only — the cost-attributed person. Undefined (NOT null)
     *  for expense subjects: that hides the picker entirely. */
    currentAttributedToPersonId?: string | null;
    projectOptions: ApprovalProjectOption[];
    personOptions: ApprovalPersonOption[];
    categoryOptions: ApprovalCategoryOption[];
    /** Flagged when the subject came in without a project tag (e.g.
     *  a Navan booking whose trip name didn't match a Foundry code)
     *  — drives the "needs allocation" amber chip. */
    needsAllocation?: boolean;
  };
}) {
  const [state, action] = useFormState<DecisionState, FormData>(decideApproval, {
    status: 'idle',
  });
  const [mode, setMode] = useState<'hidden' | 'approve' | 'reject'>('hidden');
  const [projectOverride, setProjectOverride] = useState<string>(
    allocationContext?.currentProjectId ?? '',
  );
  const [categoryOverride, setCategoryOverride] = useState<string>(
    allocationContext?.currentCategory ?? '',
  );
  const [personOverride, setPersonOverride] = useState<string>(
    allocationContext?.currentAttributedToPersonId ?? '',
  );

  if (state.status === 'error') {
    return <p className="text-xs text-status-red">{state.message}</p>;
  }

  if (mode === 'hidden') {
    return (
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setMode('reject')}>
          Reject
        </Button>
        <Button type="button" size="sm" onClick={() => setMode('approve')}>
          Approve
        </Button>
      </div>
    );
  }

  const showOverrides =
    mode === 'approve' &&
    allocationContext &&
    allocationContext.canOverrideAllocation;
  // Attributed-user picker is bills-only. Undefined (NOT null) on the
  // expense branch hides the row entirely — null means "no one is
  // attributed yet" and we still want the picker.
  const showAttributedTo =
    showOverrides &&
    allocationContext.subjectType === 'bill' &&
    allocationContext.currentAttributedToPersonId !== undefined;

  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="approvalId" value={approvalId} />
      <input type="hidden" name="decision" value={mode === 'approve' ? 'approved' : 'rejected'} />
      <Input
        name="note"
        placeholder={mode === 'reject' ? 'Reason (required)' : 'Note (optional)'}
        required={mode === 'reject'}
        className="min-w-[240px]"
      />
      {showOverrides && allocationContext && (
        <div className="flex w-full flex-col items-end gap-3 rounded-md border border-line bg-surface-subtle/40 p-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
            Admin allocation
          </span>

          {/* Project picker. Empty string == "no project / OPEX". The
              server only patches when the dropdown moved off the
              original value. */}
          <div className="flex w-full flex-col items-end gap-1">
            <label className="text-[10px] uppercase tracking-wider text-ink-3">
              {allocationContext.needsAllocation
                ? 'Project code (required — Navan / untagged)'
                : 'Project code'}
            </label>
            <select
              name="projectIdOverride"
              value={projectOverride}
              onChange={(e) => setProjectOverride(e.target.value)}
              required={allocationContext.needsAllocation}
              className={`h-8 min-w-[260px] rounded-md border bg-surface-elev px-2 text-sm text-ink ${
                allocationContext.needsAllocation && !projectOverride
                  ? 'border-status-amber'
                  : 'border-line'
              }`}
            >
              <option value="">— OPEX (no project) —</option>
              {/* Pin the current project as "(current)" when it's
                  filtered out of the visible options. */}
              {allocationContext.currentProjectId &&
                !allocationContext.projectOptions.some(
                  (p) => p.id === allocationContext.currentProjectId,
                ) && (
                  <option value={allocationContext.currentProjectId}>
                    (current) {allocationContext.currentProjectCode ?? '?'}
                    {allocationContext.currentProjectName
                      ? ` — ${allocationContext.currentProjectName}`
                      : ''}
                  </option>
                )}
              {allocationContext.projectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            {projectOverride !== (allocationContext.currentProjectId ?? '') && (
              <span className="text-[10px] text-status-amber">
                Re-routing to a new project on approve
              </span>
            )}
          </div>

          {/* Associated-user picker — bills only. Empty string ==
              "no one attributed" (un-pin). Submitter on an expense
              IS the attributed user by definition; that's why we
              don't expose this picker for expense subjects. */}
          {showAttributedTo && (
            <div className="flex w-full flex-col items-end gap-1">
              <label className="text-[10px] uppercase tracking-wider text-ink-3">
                Associated user (cost attributed to)
              </label>
              <select
                name="attributedToPersonIdOverride"
                value={personOverride}
                onChange={(e) => setPersonOverride(e.target.value)}
                className="h-8 min-w-[260px] rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
              >
                <option value="">— No one attributed —</option>
                {allocationContext.personOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.firstName} {p.lastName}
                  </option>
                ))}
              </select>
              {personOverride !==
                (allocationContext.currentAttributedToPersonId ?? '') && (
                <span className="text-[10px] text-status-amber">
                  Re-attributing this cost on approve
                </span>
              )}
            </div>
          )}

          {/* Cost-type picker. Drives the Xero GL account on push. */}
          <div className="flex w-full flex-col items-end gap-1">
            <label className="text-[10px] uppercase tracking-wider text-ink-3">
              Cost type
            </label>
            <select
              name="categoryOverride"
              value={categoryOverride}
              onChange={(e) => setCategoryOverride(e.target.value)}
              className="h-8 min-w-[260px] rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
            >
              <option value="">— Keep current —</option>
              {allocationContext.categoryOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            {categoryOverride !== '' &&
              categoryOverride !== (allocationContext.currentCategory ?? '') && (
                <span className="text-[10px] text-status-amber">
                  Re-classifying to a new cost type on approve
                </span>
              )}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setMode('hidden')}>
          Cancel
        </Button>
        <SubmitButton mode={mode} />
      </div>
    </form>
  );
}

function SubmitButton({ mode }: { mode: 'approve' | 'reject' }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={mode === 'reject' ? 'destructive' : 'default'}
      disabled={pending}
    >
      {pending ? '…' : mode === 'reject' ? 'Confirm reject' : 'Confirm approve'}
    </Button>
  );
}
