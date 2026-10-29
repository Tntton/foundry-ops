'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { decideTimesheetEntries, type TimesheetSaveState } from '../actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PersonAvatar } from '@/components/person-avatar';

export type MonthCardProject = {
  projectId: string;
  projectCode: string;
  projectName: string;
  hours: number;
  entryIds: string[];
  canDecide: boolean;
  owedByName: string | null;
};

export type MonthCardEntry = {
  id: string;
  date: string;
  hours: number;
  description: string;
  projectCode: string;
  canDecide: boolean;
};

/**
 * One person's month, as a single approvable unit.
 *
 * The queue used to group by ISO week, so a monthly lodgement arrived as five
 * separate cards and a manager approved the same person five times. This is
 * the batch unit the monthly workflow needs (TASK-503).
 *
 * A manager who leads some but not all of the month's projects sees the whole
 * month — otherwise the card claims 8h when the month is 140h — but the
 * approve action only ever carries the entries they can actually decide. The
 * rest is listed with who owes it, so the submitter can chase the right
 * person instead of guessing.
 */
export function ApproveMonthCard({
  personName,
  initials,
  headshotUrl,
  monthLabel,
  periodState,
  projects,
  entries,
  totalHours,
  decidableHours,
  decidableEntryIds,
}: {
  personName: string;
  initials: string;
  headshotUrl: string | null;
  monthLabel: string;
  periodState: 'open' | 'lodged' | 'approved' | 'invoiced' | null;
  projects: MonthCardProject[];
  entries: MonthCardEntry[];
  totalHours: number;
  decidableHours: number;
  decidableEntryIds: string[];
}) {
  const [state, action] = useFormState<TimesheetSaveState, FormData>(
    decideTimesheetEntries,
    { status: 'idle' },
  );
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState('');

  const outstanding = projects.filter((p) => !p.canDecide);
  const partial = outstanding.length > 0;

  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PersonAvatar
          className="h-7 w-7"
          fallbackClassName="text-[10px]"
          initials={initials}
          headshotUrl={headshotUrl}
        />
        <div className="font-medium text-ink">{personName}</div>
        <span className="text-sm text-ink-3">· {monthLabel}</span>
        {periodState === 'lodged' ? (
          <Badge variant="outline" className="text-[10px]" title="Lodged as a whole month.">
            lodged
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="text-[10px]"
            title="Submitted week by week rather than lodged as a month."
          >
            not lodged
          </Badge>
        )}
        <Badge variant="amber" className="ml-auto">
          {totalHours.toFixed(1)}h
        </Badge>
      </div>

      <ul className="mb-3 divide-y divide-line text-sm">
        {projects.map((p) => (
          <li key={p.projectId} className="flex items-center gap-2 py-1.5">
            <span className="font-mono text-xs text-ink-4">{p.projectCode}</span>
            <span className="truncate text-xs text-ink-2">{p.projectName}</span>
            <span className="ml-auto tabular-nums text-xs text-ink">
              {p.hours.toFixed(1)}h
            </span>
            {p.canDecide ? (
              <Badge variant="green" className="text-[10px]">
                yours
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[10px] text-ink-3"
                title={
                  p.owedByName
                    ? `${p.owedByName} leads this project and owes the decision.`
                    : 'No lead on file for this project — an admin can decide it.'
                }
              >
                {p.owedByName ? `with ${p.owedByName}` : 'no lead'}
              </Badge>
            )}
          </li>
        ))}
      </ul>

      {partial && (
        <p className="mb-3 rounded-md border border-line bg-surface-subtle px-2 py-1.5 text-[11px] text-ink-3">
          You can approve {decidableHours.toFixed(1)}h of this month. The rest stays with
          the other leads — the month closes, and any contractor invoice is raised, only
          once every project is approved.
        </p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mb-2 text-xs text-brand hover:underline"
      >
        {expanded ? 'Hide' : 'Show'} {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
      </button>

      {expanded && (
        <ul className="mb-3 max-h-64 divide-y divide-line overflow-y-auto text-xs">
          {entries.map((e) => (
            <li
              key={e.id}
              className={`grid grid-cols-[90px_70px_50px_1fr] items-center gap-2 py-1 ${
                e.canDecide ? '' : 'opacity-50'
              }`}
            >
              <span className="tabular-nums text-ink-3">{e.date}</span>
              <span className="font-mono text-ink-4">{e.projectCode}</span>
              <span className="text-right tabular-nums text-ink">{e.hours.toFixed(2)}h</span>
              <span className="truncate text-ink-3">{e.description}</span>
            </li>
          ))}
        </ul>
      )}

      {state.status === 'error' && (
        <div className="mb-2 rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-xs text-status-red">
          {state.message}
        </div>
      )}
      {state.status === 'success' && (
        <div className="mb-2 rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-xs text-status-green">
          {state.message}
        </div>
      )}

      <form action={action} className="flex flex-wrap items-center gap-2">
        {decidableEntryIds.map((id) => (
          <input key={id} type="hidden" name="entryId" value={id} />
        ))}
        <input type="hidden" name="note" value={note} />
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (required to send back)"
          className="h-8 max-w-xs text-xs"
        />
        <DecideButton
          decision="approved"
          label={`Approve ${decidableHours.toFixed(1)}h`}
          variant="default"
        />
        <DecideButton decision="rejected" label="Send back" variant="outline" />
      </form>
    </div>
  );
}

function DecideButton({
  decision,
  label,
  variant,
}: {
  decision: 'approved' | 'rejected';
  label: string;
  variant: 'default' | 'outline';
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="decision"
      value={decision}
      size="sm"
      variant={variant}
      disabled={pending}
    >
      {pending ? 'Working…' : label}
    </Button>
  );
}
