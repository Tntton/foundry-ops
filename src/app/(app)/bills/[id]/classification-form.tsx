'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { useMemo, useState } from 'react';
import {
  patchBillClassification,
  type BillClassificationState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type BillProjectOption = {
  id: string;
  code: string;
  name: string;
};

export type BillPersonOption = {
  id: string;
  firstName: string;
  lastName: string;
};

export type BillCategoryOption = {
  value: string;
  label: string;
};

/**
 * Editable Classification panel on the bill detail page. Admin
 * (super_admin / admin via `bill.approve` capability) can re-tag
 * project, re-classify cost type, re-attribute the cost recipient
 * and set a cost centre inline — no separate edit-mode toggle, no
 * round-trip to /approvals.
 *
 * Non-admin renders the read-only twin (Classification rows as
 * static text). The page chooses which to render based on the
 * capability — this component assumes admin if it's mounted.
 *
 * Save button only enables once a field is dirty. Saved state
 * (idle / error / success) renders inline; pending uses
 * useFormStatus.
 */
export function BillClassificationForm({
  billId,
  initial,
  projectOptions,
  personOptions,
  categoryOptions,
}: {
  billId: string;
  initial: {
    projectId: string | null;
    projectCode: string | null;
    projectName: string | null;
    attributedToPersonId: string | null;
    attributedToName: string | null;
    costCentre: string | null;
    category: string;
    receivedVia: string;
    attachmentSharepointUrl: string | null;
  };
  projectOptions: BillProjectOption[];
  personOptions: BillPersonOption[];
  categoryOptions: BillCategoryOption[];
}) {
  const boundAction = patchBillClassification.bind(null, billId);
  const [state, action] = useFormState<BillClassificationState, FormData>(
    boundAction,
    { status: 'idle' },
  );

  const [projectId, setProjectId] = useState<string>(initial.projectId ?? '');
  const [attributedToPersonId, setAttributedToPersonId] = useState<string>(
    initial.attributedToPersonId ?? '',
  );
  const [costCentre, setCostCentre] = useState<string>(initial.costCentre ?? '');
  const [category, setCategory] = useState<string>(initial.category);

  const isDirty = useMemo(
    () =>
      projectId !== (initial.projectId ?? '') ||
      attributedToPersonId !== (initial.attributedToPersonId ?? '') ||
      (costCentre.trim() || null) !== (initial.costCentre ?? null) ||
      category !== initial.category,
    [
      projectId,
      attributedToPersonId,
      costCentre,
      category,
      initial.projectId,
      initial.attributedToPersonId,
      initial.costCentre,
      initial.category,
    ],
  );

  return (
    <form action={action} className="space-y-2 text-sm">
      <Row label="Category">
        <select
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 w-full max-w-[360px] rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
        >
          {/* Preserve the current value as a leading option even if
              it's not in the canonical list (legacy bills imported
              with free-form categories like "travel" lowercase). */}
          {[
            ...categoryOptions,
            !categoryOptions.some((c) => c.value === initial.category)
              ? { value: initial.category, label: `${initial.category} (legacy)` }
              : null,
          ]
            .filter((c): c is BillCategoryOption => c !== null)
            .map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
        </select>
      </Row>

      <Row label="Project">
        <div className="flex max-w-[360px] flex-col gap-1">
          <select
            name="projectId"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-9 w-full rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            <option value="">— OPEX (no project) —</option>
            {/* Pin the bill's current project as "(current)" when
                it's filtered out of the visible options (FHB000 /
                FHO000). Keeps the controlled-select value in sync
                with its options. */}
            {initial.projectId &&
              !projectOptions.some((p) => p.id === initial.projectId) && (
                <option value={initial.projectId}>
                  (current) {initial.projectCode ?? '?'}
                  {initial.projectName ? ` — ${initial.projectName}` : ''}
                </option>
              )}
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
          {/* When unchanged, surface the link the read-only twin
              would have shown — saves admin a hunt when they wanted
              the project page rather than re-allocation. */}
          {projectId === (initial.projectId ?? '') && initial.projectCode && (
            <Link
              href={`/projects/${initial.projectCode}`}
              className="text-[11px] text-ink-3 hover:text-brand hover:underline"
            >
              Open project page →
            </Link>
          )}
        </div>
      </Row>

      <Row label="Associated user">
        <select
          name="attributedToPersonId"
          value={attributedToPersonId}
          onChange={(e) => setAttributedToPersonId(e.target.value)}
          className="h-9 w-full max-w-[360px] rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
        >
          <option value="">— No one attributed —</option>
          {personOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Cost centre">
        <Input
          name="costCentre"
          value={costCentre}
          onChange={(e) => setCostCentre(e.target.value)}
          placeholder="—"
          className="max-w-[360px]"
          maxLength={64}
        />
      </Row>

      <Row label="Received via">
        <span className="text-ink-3">{initial.receivedVia}</span>
      </Row>
      <Row label="Attachment">
        {initial.attachmentSharepointUrl ? (
          <a
            href={initial.attachmentSharepointUrl}
            target="_blank"
            rel="noreferrer"
            className="text-brand hover:underline"
          >
            Open in SharePoint →
          </a>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </Row>

      <div className="flex items-center justify-end gap-2 pt-2">
        {state.status === 'error' && (
          <span className="text-xs text-status-red">{state.message}</span>
        )}
        {state.status === 'success' && (
          <span className="text-xs text-status-green">{state.message}</span>
        )}
        <SaveButton disabled={!isDirty} />
      </div>
    </form>
  );
}

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending || disabled}>
      {pending ? 'Saving…' : 'Save classification'}
    </Button>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-center gap-2 py-1">
      <div className="text-ink-3">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}
