'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useMemo, useState } from 'react';
import { saveTimesheet, type TimesheetSaveState } from './actions';
import type { TimesheetRow } from '@/server/timesheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatDayLabel } from '@/lib/week';

type ProjectOption = { id: string; code: string; name: string };

export function TimesheetGrid({
  weekStart,
  initialRows,
  weekDates,
  allProjects,
}: {
  weekStart: string;
  initialRows: TimesheetRow[];
  weekDates: Date[];
  allProjects: ProjectOption[];
}) {
  const [rows, setRows] = useState(initialRows);
  const [state, action] = useFormState<TimesheetSaveState, FormData>(saveTimesheet, {
    status: 'idle',
  });

  const usedProjectIds = useMemo(() => new Set(rows.map((r) => r.projectId)), [rows]);
  const addableProjects = allProjects.filter((p) => !usedProjectIds.has(p.id));

  const dailyTotals = weekDates.map((_, i) =>
    rows.reduce((sum, r) => sum + (r.cells[i]?.hours ?? 0), 0),
  );
  const weekTotal = dailyTotals.reduce((s, h) => s + h, 0);

  function setHours(projectId: string, dayIdx: number, hours: number) {
    setRows((prev) =>
      prev.map((r) =>
        r.projectId === projectId
          ? {
              ...r,
              cells: r.cells.map((c, i) =>
                i === dayIdx ? { ...c, hours: Number.isFinite(hours) ? hours : 0 } : c,
              ),
            }
          : r,
      ),
    );
  }

  function setDescription(projectId: string, description: string) {
    setRows((prev) => prev.map((r) => (r.projectId === projectId ? { ...r, description } : r)));
  }

  function addRow(p: ProjectOption) {
    setRows((prev) => [
      ...prev,
      {
        projectId: p.id,
        projectCode: p.code,
        projectName: p.name,
        description: '',
        status: 'draft',
        cells: weekDates.map((date) => ({ date, hours: 0 })),
      },
    ]);
  }

  function removeRow(projectId: string) {
    setRows((prev) => prev.filter((r) => r.projectId !== projectId));
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="weekStart" value={weekStart} />

      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}
      {state.status === 'success' && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          {state.message}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-line bg-card">
        <table className="w-full text-sm">
          <thead className="bg-surface-subtle text-ink-3">
            <tr className="border-b border-line">
              <th className="min-w-[220px] px-3 py-2 text-left">Project</th>
              {weekDates.map((d, i) => (
                <th key={i} className="min-w-[64px] px-2 py-2 text-center">
                  <div className="text-[10px] font-medium uppercase tracking-wide">
                    {formatDayLabel(d)}
                  </div>
                </th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={weekDates.length + 3}
                  className="p-8 text-center text-sm text-ink-3"
                >
                  No rows yet — add a project below to start.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const total = r.cells.reduce((s, c) => s + c.hours, 0);
                const locked = r.status === 'approved' || r.status === 'billed';
                return (
                  <tr key={r.projectId} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-ink-3">{r.projectCode}</span>
                          <span className="text-sm text-ink">{r.projectName}</span>
                          <StatusBadge status={r.status} />
                        </div>
                        <input type="hidden" name="projectId" value={r.projectId} />
                        <Input
                          name={`description::${r.projectId}`}
                          value={r.description}
                          onChange={(e) => setDescription(r.projectId, e.target.value)}
                          placeholder="Description (required if logging hours)"
                          disabled={locked}
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                    </td>
                    {r.cells.map((c, i) => (
                      <td key={i} className="px-1 py-2">
                        <input
                          name={`hours::${r.projectId}::${i}`}
                          type="number"
                          min="0"
                          max="24"
                          step="0.25"
                          value={c.hours === 0 ? '' : String(c.hours)}
                          onChange={(e) =>
                            setHours(r.projectId, i, parseFloat(e.target.value || '0'))
                          }
                          disabled={locked}
                          placeholder="0"
                          className={cn(
                            'h-8 w-full rounded-md border border-line bg-surface-elev px-1 text-center text-sm tabular-nums text-ink focus:outline-none focus:ring-1 focus:ring-ring',
                            locked && 'bg-surface-subtle',
                          )}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-2">
                      {total.toFixed(2)}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {!locked && (
                        <button
                          type="button"
                          onClick={() => removeRow(r.projectId)}
                          className="text-xs text-ink-3 hover:text-ink"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot className="bg-surface-subtle">
            <tr>
              <td className="px-3 py-2 text-right text-xs uppercase text-ink-3">Daily total</td>
              {dailyTotals.map((t, i) => (
                <td
                  key={i}
                  className={cn(
                    'px-1 py-2 text-center font-mono tabular-nums',
                    t > 24 ? 'text-status-red' : 'text-ink-2',
                  )}
                >
                  {t.toFixed(1)}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-mono text-ink">
                {weekTotal.toFixed(2)}h
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {addableProjects.length > 0 ? (
          <AddRowPicker projects={addableProjects} onAdd={addRow} />
        ) : (
          <span className="text-xs text-ink-3">All your projects are on the sheet.</span>
        )}
        <div className="flex items-center gap-2">
          <SaveButton intent="save" label="Save draft" variant="outline" />
          <SaveButton intent="submit" label="Submit for approval" variant="default" />
        </div>
      </div>
    </form>
  );
}

function AddRowPicker({
  projects,
  onAdd,
}: {
  projects: ProjectOption[];
  onAdd: (p: ProjectOption) => void;
}) {
  const [selected, setSelected] = useState<string>('');
  const selectedProject = projects.find((p) => p.id === selected);
  return (
    <div className="flex items-center gap-2">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
      >
        <option value="">— Add project row —</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} · {p.name}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!selectedProject}
        onClick={() => {
          if (selectedProject) {
            onAdd(selectedProject);
            setSelected('');
          }
        }}
      >
        Add
      </Button>
    </div>
  );
}

function SaveButton({
  intent,
  label,
  variant,
}: {
  intent: 'save' | 'submit';
  label: string;
  variant: 'default' | 'outline';
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="intent"
      value={intent}
      variant={variant}
      disabled={pending}
    >
      {pending ? '…' : label}
    </Button>
  );
}

function StatusBadge({ status }: { status: TimesheetRow['status'] }) {
  const map: Record<TimesheetRow['status'], { label: string; variant: 'outline' | 'amber' | 'green' | 'blue' | 'red' }> = {
    draft: { label: 'draft', variant: 'outline' },
    submitted: { label: 'submitted', variant: 'amber' },
    approved: { label: 'approved', variant: 'green' },
    billed: { label: 'billed', variant: 'blue' },
    mixed: { label: 'mixed', variant: 'red' },
  };
  const s = map[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
