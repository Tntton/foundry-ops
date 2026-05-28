'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { saveRateCardChanges, type RateCardSaveState } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type EditableRow = {
  id: string;
  roleCode: string;
  roleLabel: string;
  /** Optional clarifier shown under the role label. Used by the
   *  leadership-tier rows (Partner / Associate Partner) to call out
   *  the dual rem model + that rates are optional. */
  roleSubnote?: string;
  band: string;
  effectiveFromIso: string;
  costRateCents: number;
  billRateLowCents: number;
  billRateHighCents: number;
};

const initial: RateCardSaveState = { status: 'idle' };

/**
 * Inline-editable rate card with a single "effective from" date picker
 * at the top. Save creates new versioned rows for any role whose
 * costRate / billRateLow / billRateHigh changed; rows that match the
 * current effective row are no-ops.
 *
 * Existing history is never mutated — that's the contract that lets
 * historical project costs stay stable. Any back-dated edit attempt
 * is rejected by the server (`effectiveFrom < today`).
 */
export function EditableRateCardTable({
  rows,
  defaultEffectiveFromIso,
  canEdit,
}: {
  rows: EditableRow[];
  /** Pre-fills the effective-from date input with today (or a future
   *  date if today is past the working day's UI cutoff). */
  defaultEffectiveFromIso: string;
  canEdit: boolean;
}) {
  const [state, action] = useFormState<RateCardSaveState, FormData>(
    saveRateCardChanges,
    initial,
  );

  // Local edit state — every row keeps its own dollars-as-string so
  // intermediate keystrokes don't get reformatted (e.g. typing 250
  // shouldn't snap to "$250" mid-edit). Initial values come from the
  // currently-effective row's cents → dollars roundtrip.
  const [edits, setEdits] = useState(() =>
    rows.map((r) => ({
      roleCode: r.roleCode,
      cost: dollarsFromCents(r.costRateCents),
      billLow: dollarsFromCents(r.billRateLowCents),
      billHigh: dollarsFromCents(r.billRateHighCents),
    })),
  );
  const [effectiveFrom, setEffectiveFrom] = useState(defaultEffectiveFromIso);

  function patch(
    roleCode: string,
    field: 'cost' | 'billLow' | 'billHigh',
    value: string,
  ) {
    setEdits((prev) =>
      prev.map((e) => (e.roleCode === roleCode ? { ...e, [field]: value } : e)),
    );
  }

  // Per-row "changed?" flag — drives the subtle highlight + the save
  // counter. Compares the operator's current dollars against the
  // baseline (rounded to whole dollars on read since cents-precision
  // bill rates are rare and the inputs are integer-only).
  const changedCount = edits.filter((e, i) => {
    const r = rows[i]!;
    return (
      Number(e.cost || '0') !== r.costRateCents / 100 ||
      Number(e.billLow || '0') !== r.billRateLowCents / 100 ||
      Number(e.billHigh || '0') !== r.billRateHighCents / 100
    );
  }).length;

  return (
    <form action={action} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-card p-3">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <span className="text-ink-3">Effective from</span>
          <Input
            type="date"
            name="effectiveFrom"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            min={new Date().toISOString().slice(0, 10)}
            required
            disabled={!canEdit}
            className="max-w-[180px]"
          />
        </label>
        <span className="text-xs text-ink-3">
          Prospective only — back-dated changes are rejected so completed
          projects stay costed against the rates they were quoted at.
        </span>
        {canEdit && (
          <SaveButton
            disabled={changedCount === 0}
            label={
              changedCount === 0
                ? 'No changes'
                : `Save ${changedCount} change${changedCount === 1 ? '' : 's'}`
            }
          />
        )}
      </div>

      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}
      {state.status === 'success' && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          {state.changedCount === 0
            ? 'No changes to save.'
            : `Saved ${state.changedCount} new rate${state.changedCount === 1 ? '' : 's'} effective ${state.effectiveFrom}.`}
        </div>
      )}

      <div className="rounded-md border border-line bg-card p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Band</TableHead>
              <TableHead>Currently from</TableHead>
              <TableHead className="text-right">Cost / hr</TableHead>
              <TableHead className="text-right">Bill (low)</TableHead>
              <TableHead className="text-right">Bill (high)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, idx) => {
              const e = edits[idx]!;
              const changed =
                Number(e.cost || '0') !== r.costRateCents / 100 ||
                Number(e.billLow || '0') !== r.billRateLowCents / 100 ||
                Number(e.billHigh || '0') !== r.billRateHighCents / 100;
              return (
                <TableRow
                  key={r.id}
                  className={changed ? 'bg-status-amber-soft/25' : undefined}
                >
                  <TableCell>
                    <Badge variant="outline" className="font-mono">
                      {r.roleCode}
                    </Badge>
                    <input type="hidden" name="roleCode" value={r.roleCode} />
                  </TableCell>
                  <TableCell className="font-medium text-ink">
                    {r.roleLabel}
                    {r.roleSubnote && (
                      <div className="text-[10px] font-normal text-ink-3">
                        {r.roleSubnote}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-ink-2">{r.band}</TableCell>
                  <TableCell className="tabular-nums text-xs text-ink-3">
                    {r.effectiveFromIso}
                  </TableCell>
                  <TableCell className="text-right">
                    <RateInput
                      name="costRateDollars"
                      value={e.cost}
                      onChange={(v) => patch(r.roleCode, 'cost', v)}
                      disabled={!canEdit}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <RateInput
                      name="billRateLowDollars"
                      value={e.billLow}
                      onChange={(v) => patch(r.roleCode, 'billLow', v)}
                      disabled={!canEdit}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <RateInput
                      name="billRateHighDollars"
                      value={e.billHigh}
                      onChange={(v) => patch(r.roleCode, 'billHigh', v)}
                      disabled={!canEdit}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </form>
  );
}

function SaveButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      disabled={disabled || pending}
      className="ml-auto"
    >
      {pending ? 'Saving…' : label}
    </Button>
  );
}

function RateInput({
  name,
  value,
  onChange,
  disabled,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Input
      name={name}
      type="number"
      min={0}
      max={10000}
      step={1}
      value={value}
      onChange={(ev) => onChange(ev.target.value)}
      disabled={disabled}
      className="ml-auto h-8 w-24 text-right text-sm tabular-nums"
    />
  );
}

function dollarsFromCents(cents: number): string {
  if (cents === 0) return '0';
  return String(Math.round(cents / 100));
}
