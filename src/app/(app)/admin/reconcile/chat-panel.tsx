'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** SSE event shapes — must mirror /api/reconcile/chat. */
type ChunkMeta = { kind: 'meta'; threadId: string };
type ChunkText = { kind: 'text'; text: string };
type ChunkToolCall = { kind: 'tool_call'; id: string; name: string; input: unknown };
type ChunkToolResult = { kind: 'tool_result'; id: string; name: string; ok: boolean };
type ProposalCard = {
  kind: 'proposal_card';
  surface: string;
  token: string;
  title: string;
  fields: Array<{ label: string; value: string }>;
  confirmLabel: string;
  summary: string;
};
type ChunkError = { kind: 'error'; message: string };
type ChunkDone = { kind: 'done'; finalText: string };
type Chunk =
  | ChunkMeta
  | ChunkText
  | ChunkToolCall
  | ChunkToolResult
  | ProposalCard
  | ChunkError
  | ChunkDone;

/** What the UI renders per turn. */
type Turn = {
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: Array<{ id: string; name: string; ok: boolean | null }>;
  proposal?: ProposalCard & { resolved?: 'confirmed' | 'cancelled' | 'error'; resolvedNote?: string };
};

/**
 * Reconcile chat — text-only SSE conversation with the super-admin
 * agent at /api/reconcile/chat. Sits in the right pane of /admin/reconcile.
 *
 * Streams text deltas live, surfaces tool-call breadcrumbs inline, and
 * renders any `proposal_card` event as a Confirm / Cancel surface that
 * posts to /api/reconcile/confirm on click.
 */
export function ReconcileChatPanel({
  initialHistory,
}: {
  initialHistory: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>(() =>
    initialHistory.map((m) => ({ role: m.role, text: m.content })),
  );
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [, startTransition] = useTransition();
  const scrollerRef = useRef<HTMLDivElement>(null);

  function appendText(text: string) {
    setTurns((prev) => {
      if (prev.length === 0 || prev[prev.length - 1]!.role !== 'assistant') {
        return [...prev, { role: 'assistant', text }];
      }
      const last = prev[prev.length - 1]!;
      return [...prev.slice(0, -1), { ...last, text: last.text + text }];
    });
    queueMicrotask(() =>
      scrollerRef.current?.scrollTo({
        top: scrollerRef.current.scrollHeight,
        behavior: 'smooth',
      }),
    );
  }

  function setLastAssistant(update: (t: Turn) => Turn) {
    setTurns((prev) => {
      if (prev.length === 0 || prev[prev.length - 1]!.role !== 'assistant') {
        return [...prev, update({ role: 'assistant', text: '' })];
      }
      const last = prev[prev.length - 1]!;
      return [...prev.slice(0, -1), update(last)];
    });
  }

  async function onSubmit() {
    const trimmed = input.trim();
    if (trimmed.length === 0 || streaming) return;
    setStreaming(true);
    setInput('');
    setTurns((prev) => [...prev, { role: 'user', text: trimmed }, { role: 'assistant', text: '' }]);

    try {
      const res = await fetch('/api/reconcile/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!res.ok || !res.body) {
        const fallback = `Couldn’t reach the assistant (${res.status}). Try again.`;
        appendText(fallback);
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const raw of parts) {
          if (!raw.startsWith('data: ')) continue;
          const json = raw.slice(6).trim();
          if (json.length === 0) continue;
          let evt: Chunk;
          try {
            evt = JSON.parse(json) as Chunk;
          } catch {
            continue;
          }
          if (evt.kind === 'text') {
            appendText(evt.text);
          } else if (evt.kind === 'tool_call') {
            setLastAssistant((t) => ({
              ...t,
              toolCalls: [...(t.toolCalls ?? []), { id: evt.id, name: evt.name, ok: null }],
            }));
          } else if (evt.kind === 'tool_result') {
            setLastAssistant((t) => ({
              ...t,
              toolCalls: (t.toolCalls ?? []).map((c) =>
                c.id === evt.id ? { ...c, ok: evt.ok } : c,
              ),
            }));
          } else if (evt.kind === 'proposal_card') {
            setLastAssistant((t) => ({ ...t, proposal: evt }));
          } else if (evt.kind === 'error') {
            appendText(`\n\n⚠️ ${evt.message}`);
          }
        }
      }
    } finally {
      setStreaming(false);
    }
  }

  async function onConfirm(turnIdx: number) {
    const turn = turns[turnIdx];
    if (!turn?.proposal || turn.proposal.resolved) return;
    setTurns((prev) =>
      prev.map((t, i) =>
        i === turnIdx && t.proposal
          ? { ...t, proposal: { ...t.proposal, resolved: 'confirmed', resolvedNote: 'Applying…' } }
          : t,
      ),
    );
    try {
      // Surface name encodes the confirm kind.
      const surface = turn.proposal.surface;
      const kind = surface === 'reconcile_csv_projects'
        ? 'reconcile_csv_projects'
        : surface === 'reconcile_csv_people'
          ? 'reconcile_csv_people'
          : surface === 'reconcile_csv_timesheets'
            ? 'reconcile_csv_timesheets'
            : surface === 'reconcile_csv_contractor_invoices'
              ? 'reconcile_csv_contractor_invoices'
              : surface === 'reconcile_csv_opex_bills'
                ? 'reconcile_csv_opex_bills'
                : surface === 'reconcile_brief'
                  ? 'reconcile_brief'
                  : surface === 'reconcile_sharepoint_link'
                    ? 'reconcile_sharepoint_link'
                    : surface.startsWith('reconcile_bulk')
                      ? 'reconcile_bulk'
                      : 'reconcile_update';
      const res = await fetch('/api/reconcile/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: turn.proposal.token, kind }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      if (res.ok && data.ok) {
        setTurns((prev) =>
          prev.map((t, i) =>
            i === turnIdx && t.proposal
              ? { ...t, proposal: { ...t.proposal, resolved: 'confirmed', resolvedNote: 'Applied ✓' } }
              : t,
          ),
        );
        // Refresh the gap queue on the left so the user sees the gap clear.
        startTransition(() => router.refresh());
      } else {
        setTurns((prev) =>
          prev.map((t, i) =>
            i === turnIdx && t.proposal
              ? {
                  ...t,
                  proposal: {
                    ...t.proposal,
                    resolved: 'error',
                    resolvedNote: data.message ?? data.error ?? 'Update failed.',
                  },
                }
              : t,
          ),
        );
      }
    } catch (err) {
      console.error('[reconcile.confirm] failed:', err);
      setTurns((prev) =>
        prev.map((t, i) =>
          i === turnIdx && t.proposal
            ? { ...t, proposal: { ...t.proposal, resolved: 'error', resolvedNote: 'Network error.' } }
            : t,
        ),
      );
    }
  }

  function onCancelProposal(turnIdx: number) {
    setTurns((prev) =>
      prev.map((t, i) =>
        i === turnIdx && t.proposal
          ? { ...t, proposal: { ...t.proposal, resolved: 'cancelled', resolvedNote: 'Cancelled.' } }
          : t,
      ),
    );
  }

  async function onFileUpload(file: File) {
    // Route by extension. PDF → brief extractor. CSV → projects importer.
    const name = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf');
    const isCsv = file.type === 'text/csv' || name.endsWith('.csv');
    if (!isPdf && !isCsv) {
      setTurns((prev) => [
        ...prev,
        { role: 'user', text: `(dropped ${file.name})` },
        { role: 'assistant', text: 'Unsupported file type. Drop a CSV (projects) or a PDF (project brief). Word docs need to be converted to PDF first.' },
      ]);
      return;
    }
    const maxBytes = isPdf ? 8 * 1024 * 1024 : 2 * 1024 * 1024;
    if (file.size > maxBytes) {
      setTurns((prev) => [
        ...prev,
        { role: 'user', text: `(dropped ${file.name})` },
        { role: 'assistant', text: `File too large — ${isPdf ? 'PDFs' : 'CSVs'} must be ≤ ${Math.round(maxBytes / 1024 / 1024)}MB.` },
      ]);
      return;
    }
    setTurns((prev) => [
      ...prev,
      { role: 'user', text: `Uploading ${file.name}…` },
      { role: 'assistant', text: '' },
    ]);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // CSV type auto-detected server-side from the header row; PDFs go
      // through the brief extractor.
      fd.append('type', isPdf ? 'brief' : 'auto');
      const res = await fetch('/api/reconcile/import', { method: 'POST', body: fd });
      const data = (await res.json()) as
        | {
            ok: true;
            kind: 'proposal';
            surface: string;
            token: string;
            title: string;
            fields: Array<{ label: string; value: string }>;
            confirmLabel: string;
            summary: string;
          }
        | { ok: true; kind: 'no_op'; message: string }
        | { ok?: false; error?: string; message?: string };
      if (!res.ok || !('ok' in data) || !data.ok) {
        const msg = (data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? 'Import failed.';
        appendText(`Import failed: ${msg}`);
        return;
      }
      if (data.kind === 'no_op') {
        appendText(data.message);
        return;
      }
      setLastAssistant((t) => ({
        ...t,
        text: t.text || `Parsed ${file.name} — review the diff and confirm to apply.`,
        proposal: {
          kind: 'proposal_card',
          surface: data.surface,
          token: data.token,
          title: data.title,
          fields: data.fields,
          confirmLabel: data.confirmLabel,
          summary: data.summary,
        },
      }));
    } catch (err) {
      console.error('[reconcile.import] failed:', err);
      appendText('Network error during upload.');
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void onFileUpload(file);
  }

  return (
    <div
      className="flex h-[560px] flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div
        ref={scrollerRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-md border border-line bg-surface-subtle/40 p-3"
      >
        {turns.length === 0 ? (
          <p className="text-xs text-ink-3">
            Plain-text the question — e.g. <em>&ldquo;what should I fix first?&rdquo;</em> or
            <em> &ldquo;set the contract value on FHP002 to 50000&rdquo;</em>.
            <br />
            Drag &amp; drop a projects CSV or a project-brief PDF anywhere on this panel.
          </p>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={cn('text-sm', t.role === 'user' ? 'text-ink' : 'text-ink-2')}>
              <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
                {t.role === 'user' ? 'You' : 'Reconcile'}
              </div>
              <div className="mt-0.5 whitespace-pre-wrap">{t.text}</div>
              {t.toolCalls && t.toolCalls.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-ink-3">
                  {t.toolCalls.map((c) => (
                    <span
                      key={c.id}
                      className={cn(
                        'rounded-sm border px-1.5 py-0.5 font-mono',
                        c.ok === null
                          ? 'border-line text-ink-3'
                          : c.ok
                            ? 'border-status-green text-status-green'
                            : 'border-status-red text-status-red',
                      )}
                    >
                      {c.name}
                      {c.ok === null ? ' …' : c.ok ? ' ✓' : ' ✗'}
                    </span>
                  ))}
                </div>
              )}
              {t.proposal && (
                <div className="mt-2 rounded-md border border-status-amber/50 bg-status-amber-soft/30 p-2">
                  <div className="text-xs font-medium text-ink">{t.proposal.title}</div>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-ink-2">
                    {t.proposal.fields.map((f) => (
                      <li key={f.label} className="flex gap-1.5">
                        <span className="font-medium text-ink-3">{f.label}:</span>
                        <span className="font-mono">{f.value}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex items-center gap-2">
                    {t.proposal.resolved ? (
                      <span
                        className={cn(
                          'text-xs',
                          t.proposal.resolved === 'confirmed' && 'text-status-green',
                          t.proposal.resolved === 'cancelled' && 'text-ink-3',
                          t.proposal.resolved === 'error' && 'text-status-red',
                        )}
                      >
                        {t.proposal.resolvedNote}
                      </span>
                    ) : (
                      <>
                        <Button type="button" size="sm" onClick={() => onConfirm(i)}>
                          {t.proposal.confirmLabel}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onCancelProposal(i)}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      <form
        className="mt-2 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <textarea
          value={input}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onSubmit();
            }
          }}
          placeholder="Type instruction or question — Enter to send, Shift+Enter for new line"
          rows={2}
          className="flex-1 resize-none rounded-md border border-line bg-surface-elev px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-brand"
          disabled={streaming}
        />
        <Button type="submit" disabled={streaming || input.trim().length === 0}>
          {streaming ? 'Sending…' : 'Send'}
        </Button>
      </form>
    </div>
  );
}
