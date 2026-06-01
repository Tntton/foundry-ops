'use client';

import { useState, useTransition } from 'react';
import { updateFeedbackTriage } from './actions';

const STATUS_OPTIONS = [
  { v: 'open', label: 'Open (new)' },
  { v: 'triaged', label: 'Triaged — pending TT decision' },
  { v: 'approved', label: 'Approved — start work' },
  { v: 'in_progress', label: 'In progress' },
  { v: 'resolved', label: 'Resolved' },
  { v: 'declined', label: 'Declined' },
  { v: 'duplicate', label: 'Duplicate' },
] as const;

export function TriageForm({
  id,
  currentStatus,
  currentNotes,
}: {
  id: string;
  currentStatus: string;
  currentNotes: string;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [notes, setNotes] = useState(currentNotes);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function submit() {
    const fd = new FormData();
    fd.set('id', id);
    fd.set('status', status);
    fd.set('triageNotes', notes);
    start(async () => {
      const result = await updateFeedbackTriage({ status: 'idle' }, fd);
      if (result.status === 'error') {
        setMsg({ ok: false, text: result.message });
      } else if (result.status === 'success') {
        setMsg({ ok: true, text: 'Saved' });
        setTimeout(() => setMsg(null), 2000);
      }
    });
  }

  const dirty = status !== currentStatus || notes !== currentNotes;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-ink-3">Status:</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="h-7 rounded-md border border-line bg-surface-elev px-2 text-xs text-ink"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.v} value={o.v}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !dirty}
          className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-brand-ink hover:opacity-90 disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {msg && (
          <span
            className={`text-[11px] ${msg.ok ? 'text-status-green' : 'text-status-red'}`}
          >
            {msg.text}
          </span>
        )}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Triage notes — Claude's assessment, your decision, anything that helps the next person looking at this…"
        rows={2}
        className="w-full resize-y rounded-md border border-line bg-surface-elev px-2 py-1.5 text-xs text-ink"
      />
    </div>
  );
}
