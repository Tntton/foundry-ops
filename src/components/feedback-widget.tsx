'use client';

import { useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import { submitFeedback, type FeedbackSubmitState } from '@/app/(app)/feedback/actions';

type Urgency = 'critical' | 'urgent' | 'routine';
type Kind = 'bug' | 'feature' | 'maintenance' | 'other';

const URGENCY_LABEL: Record<Urgency, { label: string; sub: string; tone: string }> = {
  critical: {
    label: 'Critical',
    sub: 'Blocking me right now',
    tone: 'border-status-red text-status-red',
  },
  urgent: {
    label: 'Urgent',
    sub: 'Need it within a few days',
    tone: 'border-status-amber text-status-amber',
  },
  routine: {
    label: 'Routine',
    sub: 'Suggestion / nice-to-have',
    tone: 'border-line text-ink-2',
  },
};

const KIND_LABEL: Record<Kind, string> = {
  bug: 'Bug',
  feature: 'Feature request',
  maintenance: 'Maintenance',
  other: 'Other',
};

/**
 * Floating feedback widget. Lives in the bottom-right of every
 * authenticated page (mounted from (app)/layout.tsx). Click the
 * pill to expand a chat-style form; close to collapse. Tickets land
 * in the FeedbackTicket table for Claude/TT triage.
 *
 * Design choice: pre-fills the current pathname as context so triage
 * knows where the user was when they submitted.
 */
export function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [urgency, setUrgency] = useState<Urgency>('routine');
  const [kind, setKind] = useState<Kind>('other');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  const [state, setState] = useState<FeedbackSubmitState>({ status: 'idle' });

  function reset() {
    setTitle('');
    setBody('');
    setUrgency('routine');
    setKind('other');
    setState({ status: 'idle' });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set('urgency', urgency);
    fd.set('kind', kind);
    fd.set('title', title);
    fd.set('body', body);
    fd.set('contextPath', pathname);
    start(async () => {
      const result = await submitFeedback({ status: 'idle' }, fd);
      setState(result);
      if (result.status === 'success') {
        // Reset after 1.5s so user sees the success state briefly
        setTimeout(() => {
          reset();
        }, 1500);
      }
    });
  }

  return (
    <>
      {/* Trigger pill — sits to the left of the AssistantWidget so the two don't overlap.
          Assistant widget owns the bottom-right corner (primary surface). */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-[8.5rem] z-40 flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-2 text-xs font-medium text-ink-2 shadow-lg transition-all hover:bg-surface-hover hover:text-ink"
          title="Submit feedback or request a feature"
        >
          <span aria-hidden>💬</span>
          <span>Feedback</span>
        </button>
      )}

      {/* Expanded panel — full bottom-right corner is fine when open; the
          assistant pill is small enough to coexist. */}
      {open && (
        <div className="fixed bottom-4 right-4 z-40 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-line bg-card shadow-xl">
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div>
              <div className="text-sm font-semibold text-ink">Send feedback</div>
              <div className="text-[11px] text-ink-3">
                Bugs, feature requests, anything.
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                if (state.status === 'success') reset();
              }}
              className="rounded-md p-1 text-ink-3 hover:bg-surface-hover hover:text-ink"
              aria-label="Close feedback panel"
            >
              ✕
            </button>
          </header>

          {state.status === 'success' ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
              <div className="text-2xl">✓</div>
              <div className="text-sm font-medium text-ink">Thanks — logged</div>
              <div className="text-[11px] text-ink-3">
                TT will see this in the triage queue. Critical / urgent
                items get flagged immediately.
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-4 py-3">
              {/* Urgency picker — three radio pills */}
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  Urgency
                </label>
                <div className="flex flex-col gap-1.5">
                  {(['critical', 'urgent', 'routine'] as Urgency[]).map((u) => {
                    const meta = URGENCY_LABEL[u];
                    const active = urgency === u;
                    return (
                      <label
                        key={u}
                        className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                          active
                            ? `${meta.tone} bg-surface-elev`
                            : 'border-line text-ink-3 hover:bg-surface-hover'
                        }`}
                      >
                        <input
                          type="radio"
                          name="urgency"
                          value={u}
                          checked={active}
                          onChange={() => setUrgency(u)}
                          className="mt-0.5"
                        />
                        <span className="flex-1">
                          <span className="font-medium">{meta.label}</span>
                          <span className="ml-1 text-[10px] text-ink-3">
                            · {meta.sub}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Kind */}
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  Type
                </label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as Kind)}
                  className="h-8 w-full rounded-md border border-line bg-surface-elev px-2 text-xs text-ink"
                >
                  {(['bug', 'feature', 'maintenance', 'other'] as Kind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Title */}
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  Short title
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Timesheet submit button greyed out"
                  maxLength={200}
                  required
                  className="h-8 w-full rounded-md border border-line bg-surface-elev px-2 text-xs text-ink"
                />
              </div>

              {/* Body */}
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-3">
                  Details
                </label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="What were you doing? What did you expect to happen?"
                  maxLength={4000}
                  rows={4}
                  required
                  className="w-full resize-none rounded-md border border-line bg-surface-elev px-2 py-1.5 text-xs text-ink"
                />
                <div className="mt-0.5 text-[10px] text-ink-4">
                  Current page (auto-attached): <code>{pathname}</code>
                </div>
              </div>

              {state.status === 'error' && (
                <div className="rounded-md border border-status-red bg-status-red-soft px-2 py-1 text-[11px] text-status-red">
                  {state.message}
                </div>
              )}

              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-ink hover:opacity-90 disabled:opacity-60"
              >
                {pending ? 'Sending…' : 'Submit feedback'}
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
