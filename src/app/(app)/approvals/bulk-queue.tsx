'use client';

import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { decideApprovalBulk, type BulkDecisionState } from './actions';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DecisionForm } from './decision-form';

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
  requestedBy: { initials: string; firstName: string; lastName: string };
};

export function BulkApprovalQueue({ items }: { items: QueueItemLite[] }) {
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
                <div className="flex items-center gap-2 text-xs text-ink-3">
                  <Avatar className="h-5 w-5">
                    <AvatarFallback className="text-[9px]">
                      {item.requestedBy.initials}
                    </AvatarFallback>
                  </Avatar>
                  <span>
                    {item.requestedBy.firstName} {item.requestedBy.lastName} · submitted{' '}
                    {createdAt.toLocaleDateString('en-AU')}
                  </span>
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
                <DecisionForm approvalId={item.id} />
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
