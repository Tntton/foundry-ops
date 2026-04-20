'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { decideTimesheetEntries, type TimesheetSaveState } from '../actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type EntrySummary = {
  id: string;
  date: string;
  hours: number;
  description: string;
  projectCode: string;
  projectName: string;
};

export function ApproveTimesheetForm({ entries }: { entries: EntrySummary[] }) {
  const [state, action] = useFormState<TimesheetSaveState, FormData>(decideTimesheetEntries, {
    status: 'idle',
  });
  const [selected, setSelected] = useState<Set<string>>(new Set(entries.map((e) => e.id)));
  const [note, setNote] = useState('');

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={action} className="space-y-3">
      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-xs text-status-red">
          {state.message}
        </div>
      )}
      {state.status === 'success' && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-xs text-status-green">
          {state.message}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-subtle text-xs text-ink-3">
            <tr>
              <th className="w-8 px-2 py-1"></th>
              <th className="px-2 py-1 text-left">Date</th>
              <th className="px-2 py-1 text-left">Project</th>
              <th className="px-2 py-1 text-left">Description</th>
              <th className="px-2 py-1 text-right">Hours</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-t border-line">
                <td className="px-2 py-1">
                  <input
                    type="checkbox"
                    name="entryId"
                    value={e.id}
                    checked={selected.has(e.id)}
                    onChange={() => toggle(e.id)}
                  />
                </td>
                <td className="px-2 py-1 tabular-nums">{e.date}</td>
                <td className="px-2 py-1">
                  <span className="font-mono text-xs text-ink-3">{e.projectCode}</span>{' '}
                  <span className="text-ink-2">{e.projectName}</span>
                </td>
                <td className="px-2 py-1 text-ink-2">{e.description}</td>
                <td className="px-2 py-1 text-right font-mono tabular-nums">{e.hours.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <Input
          name="note"
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
          placeholder="Optional approve note / required reject reason"
          className="flex-1"
        />
        <DecisionButton decision="rejected" disabled={selected.size === 0 || !note.trim()}>
          Reject ({selected.size})
        </DecisionButton>
        <DecisionButton decision="approved" disabled={selected.size === 0}>
          Approve ({selected.size})
        </DecisionButton>
      </div>
    </form>
  );
}

function DecisionButton({
  decision,
  disabled,
  children,
}: {
  decision: 'approved' | 'rejected';
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="decision"
      value={decision}
      variant={decision === 'rejected' ? 'destructive' : 'default'}
      size="sm"
      disabled={pending || disabled}
    >
      {pending ? '…' : children}
    </Button>
  );
}
