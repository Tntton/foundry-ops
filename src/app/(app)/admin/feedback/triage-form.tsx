'use client';

import { useState, useTransition } from 'react';
import { updateFeedbackTriage, routeTicketToDev } from './actions';

const STATUS_OPTIONS = [
  { v: 'open', label: 'Open (new)' },
  { v: 'triaged', label: 'Triaged — pending TT decision' },
  { v: 'approved', label: 'Approved — start work' },
  { v: 'in_progress', label: 'In progress' },
  { v: 'resolved', label: 'Resolved' },
  { v: 'declined', label: 'Declined' },
  { v: 'duplicate', label: 'Duplicate' },
] as const;

const TERMINAL_STATUSES = new Set(['resolved', 'declined', 'duplicate']);

export function TriageForm({
  id,
  currentStatus,
  currentNotes,
  currentResolution,
  currentCommitRef = '',
  routedToDevAt = null,
}: {
  id: string;
  currentStatus: string;
  currentNotes: string;
  currentResolution: string;
  currentCommitRef?: string;
  routedToDevAt?: string | null;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [notes, setNotes] = useState(currentNotes);
  const [resolution, setResolution] = useState(currentResolution);
  const [commitRef, setCommitRef] = useState(currentCommitRef);
  const [routed, setRouted] = useState<boolean>(routedToDevAt !== null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function persist(opts: {
    status: string;
    triageNotes: string;
    resolutionSummary: string;
    commitRef: string;
  }) {
    const fd = new FormData();
    fd.set('id', id);
    fd.set('status', opts.status);
    fd.set('triageNotes', opts.triageNotes);
    fd.set('resolutionSummary', opts.resolutionSummary);
    fd.set('commitRef', opts.commitRef);
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

  function save() {
    persist({ status, triageNotes: notes, resolutionSummary: resolution, commitRef });
  }

  // Route to a Claude Code chat: copies the paste-ready brief to the
  // clipboard, stamps the ticket routed + in_progress, and notifies
  // the submitter. The copied brief goes straight into a code session.
  function sendToDev() {
    start(async () => {
      const result = await routeTicketToDev(id);
      if (result.status !== 'success') {
        setMsg({
          ok: false,
          text: result.status === 'error' ? result.message : 'Failed to route',
        });
        return;
      }
      try {
        await navigator.clipboard.writeText(result.brief);
        setMsg({ ok: true, text: 'Brief copied — paste into Claude Code' });
      } catch {
        // Clipboard blocked (insecure context / gesture policy) — still
        // routed; show the brief so it can be copied manually.
        setMsg({ ok: true, text: 'Routed. Copy the brief from the box below.' });
        window.prompt('Implementation brief — copy this into Claude Code:', result.brief);
      }
      setStatus('in_progress');
      setRouted(true);
      setTimeout(() => setMsg(null), 4000);
    });
  }

  // Quick-close button — collapses the whole "approve → work → resolve"
  // ceremony for tickets that don't need code work (already-fixed,
  // misunderstanding, etc.). Prompts for a one-line summary.
  function quickArchive() {
    const summary = window.prompt(
      'Resolution summary (one line — what was done, or why this is being closed):',
      resolution || '',
    );
    if (summary === null) return; // cancelled
    if (summary.trim().length === 0) {
      setMsg({ ok: false, text: 'Resolution summary required' });
      return;
    }
    setStatus('resolved');
    setResolution(summary);
    persist({
      status: 'resolved',
      triageNotes: notes,
      resolutionSummary: summary,
      commitRef,
    });
  }

  const dirty =
    status !== currentStatus ||
    notes !== currentNotes ||
    resolution !== currentResolution ||
    commitRef !== currentCommitRef;
  const showResolutionField = TERMINAL_STATUSES.has(status) || resolution.length > 0;
  // Offer "Send to Claude Code" for tickets that are greenlit but not
  // yet terminal — the point at which they should hit a code session.
  const canRouteToDev = !TERMINAL_STATUSES.has(status);
  const showCommitField =
    status === 'in_progress' || TERMINAL_STATUSES.has(status) || commitRef.length > 0;

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
          onClick={save}
          disabled={pending || !dirty}
          className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-brand-ink hover:opacity-90 disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {canRouteToDev && (
          <button
            type="button"
            onClick={sendToDev}
            disabled={pending}
            className="rounded-md border border-brand bg-brand-soft px-2.5 py-1 text-[11px] font-medium text-brand hover:opacity-90 disabled:opacity-40"
            title="Copy a paste-ready brief to the clipboard, mark this in progress, and notify the submitter"
          >
            {routed ? 'Re-copy dev brief' : 'Send to Claude Code'}
          </button>
        )}
        {routed && (
          <span className="rounded-sm bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-brand">
            routed
          </span>
        )}
        {!TERMINAL_STATUSES.has(currentStatus) && (
          <button
            type="button"
            onClick={quickArchive}
            disabled={pending}
            className="rounded-md border border-line bg-surface-elev px-2.5 py-1 text-[11px] text-ink-2 hover:bg-surface-hover hover:text-ink"
            title="Mark resolved with a one-line summary"
          >
            Archive
          </button>
        )}
        {msg && (
          <span
            className={`text-[11px] ${msg.ok ? 'text-status-green' : 'text-status-red'}`}
          >
            {msg.text}
          </span>
        )}
      </div>

      {/* Triage notes — Claude's assessment + proposed path. Shown
          for all tickets so the analysis is captured early. */}
      <div>
        <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-3">
          Triage notes (assessment / proposed action)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Claude's read of the issue + proposed approach. Filled in during triage; informs your approve/decline decision."
          rows={2}
          className="w-full resize-y rounded-md border border-line bg-surface-elev px-2 py-1.5 text-xs text-ink"
        />
      </div>

      {/* Commit / PR link — what's actually carrying the fix. Shown
          once the ticket is in progress or terminal so the queue can
          trace status → code. */}
      {showCommitField && (
        <div>
          <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-3">
            Commit / PR (SHA or URL)
          </label>
          <input
            type="text"
            value={commitRef}
            onChange={(e) => setCommitRef(e.target.value)}
            placeholder="e.g. 9bb1b20 or https://github.com/Tntton/foundry-ops/commit/…"
            className="w-full rounded-md border border-line bg-surface-elev px-2 py-1.5 font-mono text-xs text-ink"
          />
        </div>
      )}

      {/* Resolution summary — what was actually shipped (or why
          declined). Only visible once status moves to a terminal
          state, so it doesn't muddle the in-flight ticket view. */}
      {showResolutionField && (
        <div>
          <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-ink-3">
            Resolution summary (what was actually done / why declined)
          </label>
          <textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="What shipped: commit hash, brief description. Or for declined: why."
            rows={2}
            className="w-full resize-y rounded-md border border-status-green/40 bg-surface-elev px-2 py-1.5 text-xs text-ink"
          />
        </div>
      )}
    </div>
  );
}
