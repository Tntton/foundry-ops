'use client';

import { useState, useTransition } from 'react';
import {
  saveRegularDays,
  type RegularDaysFormState,
} from './regular-days-action';
import { Button } from '@/components/ui/button';

export type RegularDays = {
  enabled: boolean;
  mon: number;
  tue: number;
  wed: number;
  thu: number;
  fri: number;
  sat: number;
  sun: number;
};

const DAYS: Array<{
  key: keyof Omit<RegularDays, 'enabled'>;
  label: string;
}> = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

/**
 * "Regular days" panel — the staff member's standard weekly schedule.
 * Sits above the availability grid; when enabled, the page server-side
 * pre-fills empty cells in the editor with these per-DOW hours.
 *
 * Persists on Save. The toggle controls whether the defaulting is
 * active — turning it off leaves the schedule values stored but stops
 * pre-filling the grid.
 */
export function RegularDaysEditor({
  personId,
  targetFirstName,
  initial,
}: {
  personId: string;
  targetFirstName: string;
  initial: RegularDays;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [hours, setHours] = useState<Record<string, string>>(() => ({
    mon: String(initial.mon),
    tue: String(initial.tue),
    wed: String(initial.wed),
    thu: String(initial.thu),
    fri: String(initial.fri),
    sat: String(initial.sat),
    sun: String(initial.sun),
  }));
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<RegularDaysFormState>({ status: 'idle' });

  const totalRegular = DAYS.reduce((s, d) => {
    const n = Number(hours[d.key] ?? 0);
    return s + (Number.isFinite(n) ? n : 0);
  }, 0);

  function setDayHours(key: string, raw: string) {
    setHours((prev) => ({ ...prev, [key]: raw }));
  }

  function save() {
    setState({ status: 'idle' });
    const fd = new FormData();
    fd.set('personId', personId);
    fd.set('enabled', enabled ? '1' : '0');
    for (const d of DAYS) fd.set(d.key, String(hours[d.key] ?? '0'));
    startTransition(async () => {
      const result = await saveRegularDays({ status: 'idle' }, fd);
      setState(result);
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            {targetFirstName === 'You'
              ? 'Your regular days'
              : `${targetFirstName}'s regular days`}
          </h3>
          <p className="text-[11px] text-ink-3">
            The standard weekly schedule. When enabled, the grid below
            pre-fills empty cells with these hours so you only edit
            exceptions (leave, conferences, OOO).
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer"
          />
          <span>{enabled ? 'Default ON' : 'Default OFF'}</span>
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-20 border-b border-line bg-surface-subtle px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-ink-3" />
              {DAYS.map((d) => (
                <th
                  key={d.key}
                  className="w-[64px] border-b border-line bg-surface-subtle px-1 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-ink-3"
                >
                  {d.label}
                </th>
              ))}
              <th className="w-20 border-b border-line bg-surface-subtle px-2 py-1.5 text-right text-[10px] font-medium uppercase tracking-wide text-ink-3">
                Wk total
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="bg-surface-subtle/40 px-2 py-1.5 text-xs font-medium text-ink-2">
                Hours
              </td>
              {DAYS.map((d) => (
                <td key={d.key} className="px-1 py-1.5 text-center">
                  <input
                    type="number"
                    min={0}
                    max={24}
                    step={1}
                    value={hours[d.key] ?? ''}
                    onChange={(e) => setDayHours(d.key, e.target.value)}
                    disabled={!enabled}
                    className="h-7 w-14 rounded border border-line bg-surface-elev px-1 text-center text-xs tabular-nums text-ink focus:border-brand disabled:bg-surface-subtle disabled:text-ink-3"
                    aria-label={`Regular hours ${d.label}`}
                  />
                </td>
              ))}
              <td className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-ink">
                {totalRegular}h
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {state.status === 'error' && (
          <span className="mr-auto text-xs text-status-red">
            {state.message}
          </span>
        )}
        {state.status === 'success' && (
          <span className="mr-auto text-xs text-status-green">
            Saved · grid will reflect on next reload.
          </span>
        )}
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save regular days'}
        </Button>
      </div>
    </div>
  );
}
