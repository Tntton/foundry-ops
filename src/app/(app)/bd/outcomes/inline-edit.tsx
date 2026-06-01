'use client';

import { useState, useTransition } from 'react';
import { patchDealOutcome } from './actions';

/**
 * Two-textarea inline editor for a deal's `notes` and `lessonsLearned`
 * fields. Sits embedded in the outcomes-page row so partners can
 * append insights without leaving the review surface. Saves both
 * fields in a single round trip.
 */
export function OutcomeInlineEdit({
  id,
  initialNotes,
  initialLessons,
  commercialsVisible,
}: {
  id: string;
  initialNotes: string;
  initialLessons: string;
  /** Just used to ensure the textareas don't render when the viewer
   *  can't see commercials — the page-level gate is the source of
   *  truth; this is defence-in-depth. */
  commercialsVisible: boolean;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [lessons, setLessons] = useState(initialLessons);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  if (!commercialsVisible) return null;

  function save() {
    const fd = new FormData();
    fd.set('id', id);
    fd.set('notes', notes);
    fd.set('lessonsLearned', lessons);
    start(async () => {
      const result = await patchDealOutcome({ status: 'idle' }, fd);
      if (result.status === 'error') {
        setMsg({ ok: false, text: result.message });
      } else {
        setMsg({ ok: true, text: 'Saved' });
        setTimeout(() => setMsg(null), 2000);
      }
    });
  }

  const dirty = notes !== initialNotes || lessons !== initialLessons;
  const hasContent = notes.trim().length > 0 || lessons.trim().length > 0;

  if (!expanded) {
    return (
      <div className="mt-1 flex items-start gap-2 text-[11px] text-ink-3">
        {hasContent ? (
          <div className="flex-1 space-y-0.5">
            {notes && (
              <div>
                <span className="font-semibold text-ink-2">Reason / notes: </span>
                <span className="whitespace-pre-wrap text-ink-2">{notes}</span>
              </div>
            )}
            {lessons && (
              <div className="rounded-md border-l-2 border-status-amber bg-status-amber-soft/30 px-2 py-1">
                <span className="font-semibold text-status-amber">So what / lessons: </span>
                <span className="whitespace-pre-wrap text-ink-2">{lessons}</span>
              </div>
            )}
          </div>
        ) : (
          <span className="italic text-ink-4">
            No notes or lessons recorded yet.
          </span>
        )}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="shrink-0 rounded-md border border-line bg-surface-elev px-2 py-0.5 text-[10px] text-ink-2 hover:bg-surface-hover hover:text-ink"
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-brand bg-surface-hover p-2">
      <div>
        <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-ink-3">
          Reason / notes (what happened, client feedback)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Why we lost / why we won / feedback from the client. Factual."
          className="w-full resize-y rounded-md border border-line bg-surface-elev px-2 py-1.5 text-xs text-ink"
        />
      </div>
      <div>
        <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-ink-3">
          So what / lessons learned (strategic takeaway)
        </label>
        <textarea
          value={lessons}
          onChange={(e) => setLessons(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="What pattern does this fit? What do we do differently next time? What signal does this give us?"
          className="w-full resize-y rounded-md border border-line bg-surface-elev px-2 py-1.5 text-xs text-ink"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-brand-ink hover:opacity-90 disabled:opacity-40"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setNotes(initialNotes);
            setLessons(initialLessons);
            setExpanded(false);
          }}
          className="text-[11px] text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
        {msg && (
          <span
            className={`text-[11px] ${msg.ok ? 'text-status-green' : 'text-status-red'}`}
          >
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
