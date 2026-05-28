'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { decideApprovalBulk, type BulkDecisionState } from './actions';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DecisionForm } from './decision-form';
import { QueueRowAllocator } from './row-allocator';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function ageLabel(createdAt: Date): string {
  const hours = Math.floor((Date.now() - createdAt.getTime()) / 3600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  return `${days}d old`;
}

function subjectHref(subjectType: string, subjectId: string): string | null {
  switch (subjectType) {
    case 'invoice':
      return `/invoices/${subjectId}`;
    case 'bill':
      return `/bills/${subjectId}`;
    case 'expense':
      return `/expenses/${subjectId}`;
    default:
      return null;
  }
}

export type QueueItemLite = {
  id: string;
  subjectType: string;
  subjectId: string;
  requiredRole: string;
  amountCents: number | null;
  summary: string;
  createdAt: string; // ISO — avoid passing Date across client boundary
  requestedBy: {
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  };
  /** Current project allocation for the subject (expense OR bill).
   *  Drives the inline project-override picker on the decision form
   *  and the "needs allocation" amber chip when the value is null. */
  subjectProjectId?: string | null;
  /** Current project's code + name. Threaded through so pickers can
   *  pin a "(current) FHB000 - …" option when the row is tagged to
   *  a bucket that's otherwise filtered out of the picker. */
  subjectProjectCode?: string | null;
  subjectProjectName?: string | null;
  /** Current cost-type (category) for the subject. Drives the cost-
   *  type override picker. Free-form on Bills today, canonical enum on
   *  Expenses — the picker normalises both onto the canonical lib. */
  subjectCategory?: string | null;
  /** Current "associated user" — bills only, the traveller / cost-
   *  attributed person. Drives the person-override picker. Expenses
   *  have no override here (submitter is fixed). */
  subjectAttributedToPersonId?: string | null;
  /** Denormalised attributed-to person details for display. Surfaces
   *  the actual cost recipient (e.g. the traveller) on the queue row
   *  for bills, even when the viewer is a non-admin and personOptions
   *  isn't populated for them. Null when no one is attributed (or
   *  for expense subjects). */
  subjectAttributedTo?: {
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  } | null;
  /** Source tag for the subject — e.g. `navan_csv` / `navan_api` for
   *  firm-paid travel bills. Surfaces a small chip in the queue so
   *  the reviewing admin sees at a glance that the row came from
   *  Navan and only needs project allocation, not full review. */
  subjectSource?: string | null;
};

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

export function BulkApprovalQueue({
  items,
  projectOptions,
  personOptions,
  categoryOptions,
  canOverrideAllocation,
}: {
  items: QueueItemLite[];
  /** Eligible projects for the admin override (FHB/FHO/FHX expense
   *  buckets pre-sorted to the top). Empty when the viewer can't
   *  override. */
  projectOptions: ApprovalProjectOption[];
  /** Active people for the "associated user" picker (bills only).
   *  Empty when the viewer can't override. */
  personOptions: ApprovalPersonOption[];
  /** Canonical category list (drives Xero GL account on push). Empty
   *  when the viewer can't override. */
  categoryOptions: ApprovalCategoryOption[];
  /** True iff the viewer can override project / person / category at
   *  the approval gate. Renamed from `canOverrideProject` — same
   *  capability gate, broader scope. */
  canOverrideAllocation: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [state, action] = useFormState<BulkDecisionState, FormData>(
    decideApprovalBulk,
    { status: 'idle' },
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAll() {
    setSelected(new Set(items.map((i) => i.id)));
  }
  function clearAll() {
    setSelected(new Set());
  }

  const selectedItems = items.filter((i) => selected.has(i.id));
  const selectedValue = selectedItems.reduce((s, i) => s + (i.amountCents ?? 0), 0);
  // Selected rows whose subject still has no project tag — the bulk
  // approve endpoint skips these to force per-row allocation. Surface
  // the count up front so admin doesn't think bulk approve silently
  // ate the row.
  const selectedNeedingAllocation = selectedItems.filter(
    (i) =>
      (i.subjectType === 'expense' || i.subjectType === 'bill') &&
      (i.subjectProjectId ?? null) === null,
  ).length;

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <form
          action={action}
          className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-brand bg-card p-3 shadow-md"
        >
          <div className="flex items-center gap-2 text-sm text-ink">
            <span className="font-semibold">
              {selected.size} selected
            </span>
            {selectedValue > 0 && (
              <span className="text-ink-3">({formatMoney(selectedValue)} total)</span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="text-xs"
            >
              Clear
            </Button>
            {selected.size < items.length && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={selectAll}
                className="text-xs"
              >
                Select all {items.length}
              </Button>
            )}
          </div>
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="approvalId" value={id} />
          ))}
          <input
            type="text"
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Decision note (required on reject)"
            className="flex h-9 min-w-[240px] max-w-md flex-1 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
            maxLength={1000}
          />
          <BulkSubmit decision="approved" label={`Approve ${selected.size}`} />
          <BulkSubmit
            decision="rejected"
            label={`Reject ${selected.size}`}
            variant="destructive"
          />
          {selectedNeedingAllocation > 0 && (
            <div className="w-full rounded border border-status-amber bg-status-amber-soft px-2 py-1 text-xs text-status-amber">
              ⚠ {selectedNeedingAllocation} selected row
              {selectedNeedingAllocation === 1 ? '' : 's'} {selectedNeedingAllocation === 1 ? 'has' : 'have'} no
              project allocation — bulk approve will skip{' '}
              {selectedNeedingAllocation === 1 ? 'it' : 'them'}. Open each row
              to pick a project before approving.
            </div>
          )}
          {state.status === 'error' && (
            <div className="w-full rounded border border-status-red bg-status-red-soft px-2 py-1 text-xs text-status-red">
              {state.message}
            </div>
          )}
          {state.status === 'success' && (
            <div className="w-full rounded border border-status-green bg-status-green-soft px-2 py-1 text-xs text-status-green">
              Applied {state.applied}
              {state.skipped ? ` · ${state.skipped} skipped` : ''}
              {state.failed ? ` · ${state.failed} failed` : ''}
            </div>
          )}
        </form>
      )}

      {items.map((item) => {
        const href = subjectHref(item.subjectType, item.subjectId);
        const isSelected = selected.has(item.id);
        const createdAt = new Date(item.createdAt);
        return (
          <Card
            key={item.id}
            className={`p-4 ${isSelected ? 'border-brand ring-1 ring-brand' : ''}`}
          >
            <div className="flex items-start gap-3">
              <label className="flex cursor-pointer items-center pt-1">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(item.id)}
                  className="h-4 w-4"
                  aria-label={`Select ${item.subjectType} approval`}
                />
              </label>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="capitalize">
                    {item.subjectType.replace('_', ' ')}
                  </Badge>
                  {item.amountCents !== null && (
                    <span className="text-lg font-semibold tabular-nums text-ink">
                      {formatMoney(item.amountCents)}
                    </span>
                  )}
                  <Badge variant="amber">{item.requiredRole.replace('_', ' ')} gate</Badge>
                  <Badge variant="outline" className="text-xs">
                    {ageLabel(createdAt)}
                  </Badge>
                  {/* Flag rows that came in without a project tag —
                       admin must pick one before approve. The Navan
                       firm-paid travel imports are the headline case
                       but the same chip fires on any bill/expense
                       routed in OPEX. */}
                  {(item.subjectType === 'expense' || item.subjectType === 'bill') &&
                    (item.subjectProjectId ?? null) === null && (
                      <Badge variant="amber" className="text-[10px]">
                        ⚠ needs project allocation
                      </Badge>
                    )}
                  {item.subjectSource && (
                    <Badge variant="blue" className="text-[10px]">
                      via {item.subjectSource.replace(/_/g, ' ')}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-ink-2">
                  {href ? (
                    <Link href={href} className="hover:underline">
                      {item.summary}
                    </Link>
                  ) : (
                    item.summary
                  )}
                </p>
                {/* Inline allocator — bills only, admin only. Lets
                    admin re-tag user + project right on the queue
                    row without clicking Approve. Auto-saves on each
                    picker change. */}
                {item.subjectType === 'bill' && canOverrideAllocation && (
                  <QueueRowAllocator
                    approvalId={item.id}
                    initialProjectId={item.subjectProjectId ?? null}
                    initialProjectCode={item.subjectProjectCode ?? null}
                    initialProjectName={item.subjectProjectName ?? null}
                    initialAttributedToPersonId={
                      item.subjectAttributedToPersonId ?? null
                    }
                    projectOptions={projectOptions}
                    personOptions={personOptions}
                  />
                )}
                <div className="flex items-center gap-2 text-xs text-ink-3">
                  {/* For bills with an attributedTo person, prefer
                      that as the "cost belongs to" face. Falls back
                      to the original requestedBy (= who fired the
                      import / submission) when there's no
                      attribution. Expenses always show submitter,
                      since submitter IS the cost recipient. */}
                  {item.subjectType === 'bill' && item.subjectAttributedTo ? (
                    <>
                      <PersonAvatar
                        className="h-5 w-5"
                        fallbackClassName="text-[9px]"
                        initials={item.subjectAttributedTo.initials}
                        headshotUrl={item.subjectAttributedTo.headshotUrl}
                      />
                      <span>
                        {item.subjectAttributedTo.firstName}{' '}
                        {item.subjectAttributedTo.lastName} · cost attributed
                        {item.requestedBy.id !==
                          item.subjectAttributedToPersonId && (
                          <span className="text-ink-3">
                            {' '}
                            · imported by {item.requestedBy.firstName}{' '}
                            {item.requestedBy.lastName}
                          </span>
                        )}{' '}
                        · {createdAt.toLocaleDateString('en-AU')}
                      </span>
                    </>
                  ) : (
                    <>
                      <PersonAvatar
                        className="h-5 w-5"
                        fallbackClassName="text-[9px]"
                        initials={item.requestedBy.initials}
                        headshotUrl={item.requestedBy.headshotUrl}
                      />
                      <span>
                        {item.requestedBy.firstName} {item.requestedBy.lastName} ·
                        submitted {createdAt.toLocaleDateString('en-AU')}
                      </span>
                    </>
                  )}
                  {href && (
                    <>
                      <span>·</span>
                      <Link href={href} className="text-brand hover:underline">
                        View details →
                      </Link>
                    </>
                  )}
                </div>
              </div>
              <div className="shrink-0">
                <DecisionForm
                  approvalId={item.id}
                  allocationContext={
                    item.subjectType === 'expense' || item.subjectType === 'bill'
                      ? {
                          canOverrideAllocation,
                          subjectType: item.subjectType,
                          currentProjectId: item.subjectProjectId ?? null,
                          currentProjectCode: item.subjectProjectCode ?? null,
                          currentProjectName: item.subjectProjectName ?? null,
                          currentCategory: item.subjectCategory ?? null,
                          // Expenses don't expose an attributedTo
                          // picker — submitter is fixed. Pass undefined
                          // so the form hides the row entirely for
                          // expense subjects.
                          currentAttributedToPersonId:
                            item.subjectType === 'bill'
                              ? item.subjectAttributedToPersonId ?? null
                              : undefined,
                          projectOptions,
                          personOptions,
                          categoryOptions,
                          needsAllocation:
                            (item.subjectProjectId ?? null) === null,
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function BulkSubmit({
  decision,
  label,
  variant,
}: {
  decision: 'approved' | 'rejected';
  label: string;
  variant?: 'default' | 'destructive';
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="decision"
      value={decision}
      size="sm"
      variant={variant ?? 'default'}
      disabled={pending}
    >
      {pending ? '…' : label}
    </Button>
  );
}
