'use client';

import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

type Role = 'user' | 'assistant' | 'tool';

type ToolInvocation = {
  id: string;
  name: string;
  status: 'running' | 'ok' | 'failed';
};

type PrefillCard = {
  surface: string;
  url: string;
  summary: string;
};

type ProposalCard = {
  surface: string;
  token: string;
  title: string;
  fields: Array<{ label: string; value: string }>;
  confirmLabel: string;
  summary: string;
  /** Local UI state — flips when the user clicks Confirm. */
  status?: 'pending' | 'confirming' | 'confirmed' | 'failed';
  result?: { entityType: string; entityId: string; link?: string; summary: string };
  error?: string;
};

type AttachmentChip = {
  filename: string;
  sizeBytes: number;
  /** 'uploading' while the multipart POST is in flight; 'extracting'
   *  while the server is OCR'ing; 'done' on success; 'failed' on error. */
  status: 'uploading' | 'extracting' | 'done' | 'failed';
  summary?: string;
};

type Message = {
  id: string;
  role: Role;
  content: string;
  /** True while a streaming response is still being appended. */
  streaming?: boolean;
  /** Tool calls fired while building this assistant turn (Phase 2+). */
  tools?: ToolInvocation[];
  /** Prefill cards rendered as buttons inline (Phase 3+). */
  prefills?: PrefillCard[];
  /** Confirmation cards rendered with Confirm/Cancel (Phase 3d+). */
  proposals?: ProposalCard[];
  /** Attachments uploaded with this message (Phase 3e+). */
  attachments?: AttachmentChip[];
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp'];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Opening greeting. Kept short so the widget feels immediately ready
// rather than presenting a wall of intro copy. Answers are short by
// prompt design; users don't need the meta explanation.
const GREETING = 'What can I help with?';

/**
 * Floating in-app assistant. Lives at the bottom-right of every authed
 * page (mounted from `(app)/layout.tsx`). Click the pill → expanded
 * panel. Powered by Claude via `/api/assistant/chat`, streamed via SSE.
 *
 * Phase 2 (TASK-301) — adds read tools (list_my_approvals, find_project,
 * etc) via Anthropic's tool-use API. Tool invocations stream as chips
 * above the final text.
 */

const TOOL_LABEL: Record<string, string> = {
  list_my_approvals: 'Checking your approvals',
  list_my_projects: 'Listing your projects',
  get_my_hours_this_week: 'Reading this week’s timesheet',
  find_project: 'Searching projects',
  find_person: 'Searching people',
  get_my_expenses_recent: 'Reading your recent expenses',
  list_expense_categories: 'Loading expense categories',
  get_active_rate_card_for_role: 'Looking up rate card',
};

function toolLabel(name: string): string {
  return TOOL_LABEL[name] ?? `Running ${name}`;
}

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  function adoptFile(file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(
        `Unsupported file type: ${file.type || 'unknown'}. Drop a PDF or image.`,
      );
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `Too large: ${formatBytes(file.size)} (max ${formatBytes(MAX_UPLOAD_BYTES)}).`,
      );
      return;
    }
    setError(null);
    setPendingFile(file);
  }

  // Hydrate the active thread when the panel first opens.
  useEffect(() => {
    if (!open || hydrated) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/assistant/thread', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          messages: Message[];
        };
        if (cancelled) return;
        setMessages(data.messages ?? []);
        setHydrated(true);
      } catch (err) {
        console.error('[assistant.hydrate] failed:', err);
        if (cancelled) return;
        setError("Couldn't load conversation — close and reopen to retry.");
        // Deliberately NOT setting hydrated — leaving it false means
        // closing + reopening the panel refetches instead of dead-
        // ending until a full page refresh.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, hydrated]);

  // Auto-scroll to the latest message.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  const sendMessage = useCallback(
    async (text: string, file: File | null) => {
      const trimmed = text.trim();
      // Allow file-only send (empty text + file).
      if (!file && !trimmed) return;
      if (pending) return;
      setError(null);
      setDraft('');
      setPendingFile(null);

      const userAttachment: AttachmentChip | undefined = file
        ? {
            filename: file.name,
            sizeBytes: file.size,
            status: 'uploading',
          }
        : undefined;

      const userMsg: Message = {
        id: `local-${Date.now()}-u`,
        role: 'user',
        content: trimmed || (file ? `📎 ${file.name}` : ''),
        attachments: userAttachment ? [userAttachment] : undefined,
      };
      const replyMsg: Message = {
        id: `local-${Date.now()}-a`,
        role: 'assistant',
        content: '',
        streaming: true,
      };
      setMessages((prev) => [...prev, userMsg, replyMsg]);
      setPending(true);

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        let res: Response;
        if (file) {
          const form = new FormData();
          form.set('message', trimmed);
          form.set('attachment', file, file.name);
          res = await fetch('/api/assistant/chat', {
            method: 'POST',
            body: form,
            signal: ac.signal,
          });
          // Mark the chip as extracting once the upload completes (we
          // can't observe finer-grained progress without a custom
          // uploader; for MVP the "extracting" state shows as soon as
          // the server starts responding).
          setMessages((prev) =>
            prev.map((m) =>
              m.id === userMsg.id && m.attachments
                ? {
                    ...m,
                    attachments: m.attachments.map((a) => ({
                      ...a,
                      status: 'extracting',
                    })),
                  }
                : m,
            ),
          );
        } else {
          res = await fetch('/api/assistant/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: trimmed }),
            signal: ac.signal,
          });
        }

        if (!res.ok || !res.body) {
          const fallback = await res
            .json()
            .then((d: { message?: string }) => d.message)
            .catch(() => null);
          throw new Error(fallback ?? `Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE frames are separated by a blank line.
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const line = frame.startsWith('data: ') ? frame.slice(6) : null;
            if (!line) continue;
            let evt: {
              kind: string;
              text?: string;
              finalText?: string;
              message?: string;
              id?: string;
              name?: string;
              ok?: boolean;
              input?: unknown;
              surface?: string;
              url?: string;
              summary?: string;
              filename?: string;
              sizeBytes?: number;
              mimeType?: string;
              fields?: unknown;
              token?: string;
              title?: string;
              confirmLabel?: string;
            };
            try {
              evt = JSON.parse(line);
            } catch {
              continue;
            }
            if (evt.kind === 'text' && evt.text) {
              const delta = evt.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === replyMsg.id ? { ...m, content: m.content + delta } : m,
                ),
              );
            } else if (evt.kind === 'tool_call' && evt.id && evt.name) {
              const ti: ToolInvocation = {
                id: evt.id,
                name: evt.name,
                status: 'running',
              };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === replyMsg.id
                    ? { ...m, tools: [...(m.tools ?? []), ti] }
                    : m,
                ),
              );
            } else if (
              evt.kind === 'attachment_extracted' &&
              evt.filename &&
              evt.summary
            ) {
              const filename = evt.filename;
              const summary = evt.summary;
              const failed = summary.startsWith('OCR failed') || summary.includes('Too large');
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === userMsg.id && m.attachments
                    ? {
                        ...m,
                        attachments: m.attachments.map((a) =>
                          a.filename === filename
                            ? {
                                ...a,
                                status: failed ? 'failed' : 'done',
                                summary,
                              }
                            : a,
                        ),
                      }
                    : m,
                ),
              );
            } else if (
              evt.kind === 'prefill_card' &&
              evt.surface &&
              evt.url &&
              evt.summary
            ) {
              const card: PrefillCard = {
                surface: evt.surface,
                url: evt.url,
                summary: evt.summary,
              };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === replyMsg.id
                    ? { ...m, prefills: [...(m.prefills ?? []), card] }
                    : m,
                ),
              );
            } else if (
              evt.kind === 'proposal_card' &&
              evt.surface &&
              evt.token &&
              evt.title &&
              Array.isArray(evt.fields)
            ) {
              const card: ProposalCard = {
                surface: evt.surface,
                token: evt.token,
                title: evt.title,
                fields: evt.fields as Array<{ label: string; value: string }>,
                confirmLabel: evt.confirmLabel ?? 'Confirm',
                summary: evt.summary ?? '',
                status: 'pending',
              };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === replyMsg.id
                    ? { ...m, proposals: [...(m.proposals ?? []), card] }
                    : m,
                ),
              );
            } else if (evt.kind === 'tool_result' && evt.id) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === replyMsg.id
                    ? {
                        ...m,
                        tools: (m.tools ?? []).map((t) =>
                          t.id === evt.id
                            ? { ...t, status: evt.ok ? 'ok' : 'failed' }
                            : t,
                        ),
                      }
                    : m,
                ),
              );
            } else if (evt.kind === 'error' && evt.message) {
              setError(evt.message);
              // The server closes without a `done` frame after an
              // error — stop the typing animation or the bubble looks
              // alive while dead.
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === replyMsg.id ? { ...m, streaming: false } : m,
                ),
              );
            } else if (evt.kind === 'done') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === replyMsg.id
                    ? {
                        ...m,
                        content: evt.finalText ?? m.content,
                        streaming: false,
                      }
                    : m,
                ),
              );
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Send failed';
        console.error('[assistant.send] failed:', err);
        setError(msg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === replyMsg.id ? { ...m, streaming: false } : m,
          ),
        );
      } finally {
        setPending(false);
        abortRef.current = null;
      }
    },
    [pending],
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(draft, pendingFile);
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a newline. ⌘/Ctrl+Enter also sends.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(draft, pendingFile);
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setDragOver(true);
    }
  }
  function handleDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }
  function handleDragLeave(e: React.DragEvent) {
    // Only un-set drag state when the pointer leaves the panel
    // entirely (not when it moves over a child element).
    if (e.currentTarget === e.target) setDragOver(false);
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) adoptFile(file);
  }

  async function confirmProposal(
    messageId: string,
    token: string,
    kind: string,
  ) {
    function patch(updater: (c: ProposalCard) => ProposalCard) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.proposals
            ? {
                ...m,
                proposals: m.proposals.map((p) =>
                  p.token === token ? updater(p) : p,
                ),
              }
            : m,
        ),
      );
    }
    patch((p) => ({ ...p, status: 'confirming', error: undefined }));
    try {
      const res = await fetch('/api/assistant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, kind }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        entityType?: string;
        entityId?: string;
        link?: string;
        summary?: string;
      };
      if (!res.ok || !data.ok) {
        patch((p) => ({
          ...p,
          status: 'failed',
          error: data.message ?? data.error ?? 'Confirm failed',
        }));
        return;
      }
      patch((p) => ({
        ...p,
        status: 'confirmed',
        result: {
          entityType: data.entityType ?? 'unknown',
          entityId: data.entityId ?? '',
          link: data.link,
          summary: data.summary ?? 'Done.',
        },
      }));
    } catch (err) {
      patch((p) => ({
        ...p,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Confirm failed',
      }));
    }
  }

  function cancelProposal(messageId: string, token: string) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.proposals
          ? {
              ...m,
              proposals: m.proposals.filter((p) => p.token !== token),
            }
          : m,
      ),
    );
  }

  async function handleReset() {
    if (pending) return;
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    try {
      const res = await fetch('/api/assistant/thread/reset', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('[assistant.reset] failed:', err);
      setError("Couldn't reset the conversation — try again.");
    }
  }

  return (
    <>
      {/* Collapsed pill — bottom-right corner. The brand-coloured background
          makes it visually distinct from the neutral feedback pill. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full border border-brand bg-brand px-3 py-2 text-xs font-medium text-white shadow-lg transition-all hover:opacity-90"
          title="Ask the Foundry Ops assistant"
        >
          <span aria-hidden>✨</span>
          <span>Assistant</span>
        </button>
      )}

      {open && (
        <div
          className="fixed bottom-4 right-4 z-40 flex h-[600px] w-[400px] max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-line bg-card shadow-2xl"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand bg-brand/15 backdrop-blur-sm">
              <span className="text-3xl">📎</span>
              <div className="text-sm font-medium text-ink">
                Drop receipt or invoice
              </div>
              <div className="text-[11px] text-ink-3">PDF or image · up to 10MB</div>
            </div>
          )}
          <header className="flex items-center justify-between gap-2 border-b border-line bg-surface-elev px-4 py-2.5">
            <div>
              <div className="text-sm font-semibold text-ink">
                Assistant{' '}
                <span className="font-normal text-ink-3">· helps you move fast</span>
              </div>
              <div className="text-[11px] text-ink-3">
                Ask about your week, or drop a receipt to log it.
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleReset}
                disabled={pending}
                className="rounded-md p-1.5 text-ink-3 hover:bg-surface-hover hover:text-ink disabled:opacity-40"
                aria-label="Reset conversation"
                title="Start a fresh thread"
              >
                ↻
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-ink-3 hover:bg-surface-hover hover:text-ink"
                aria-label="Close assistant"
              >
                ✕
              </button>
            </div>
          </header>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-3 text-sm"
          >
            {messages.length === 0 ? (
              <div className="flex justify-start">
                <div className="max-w-[90%] rounded-lg bg-surface-elev px-3 py-2 text-xs text-ink">
                  {GREETING}
                </div>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {messages.map((m) => (
                  <li
                    key={m.id}
                    className={
                      m.role === 'user'
                        ? 'flex justify-end'
                        : 'flex justify-start'
                    }
                  >
                    <div
                      className={
                        m.role === 'user'
                          ? 'max-w-[85%] rounded-lg bg-brand px-3 py-2 text-xs text-white'
                          : 'max-w-[90%] rounded-lg bg-surface-elev px-3 py-2 text-xs text-ink'
                      }
                    >
                      {m.role === 'user' && m.attachments && m.attachments.length > 0 ? (
                        <AttachmentChips chips={m.attachments} />
                      ) : null}
                      {m.role === 'assistant' && m.tools && m.tools.length > 0 ? (
                        <ToolChips tools={m.tools} />
                      ) : null}
                      {m.content.length > 0 ? (
                        <AssistantMarkdown text={m.content} />
                      ) : m.streaming &&
                        (!m.tools || m.tools.every((t) => t.status !== 'running')) ? (
                        <TypingDots />
                      ) : null}
                      {m.role === 'assistant' && m.prefills && m.prefills.length > 0 ? (
                        <PrefillCards cards={m.prefills} onOpen={() => setOpen(false)} />
                      ) : null}
                      {m.role === 'assistant' && m.proposals && m.proposals.length > 0 ? (
                        <ProposalCards
                          cards={m.proposals}
                          onConfirm={(token, kind) => confirmProposal(m.id, token, kind)}
                          onCancel={(token) => cancelProposal(m.id, token)}
                        />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <div className="border-t border-status-red bg-status-red-soft px-3 py-1.5 text-[11px] text-status-red">
              {error}
            </div>
          )}

          {pendingFile && (
            <div className="flex items-center justify-between gap-2 border-t border-line bg-surface-elev px-3 py-1.5 text-[11px]">
              <span className="flex items-center gap-1.5 text-ink-2">
                <span aria-hidden>📎</span>
                <span className="font-medium text-ink">{pendingFile.name}</span>
                <span className="text-ink-3">
                  · {formatBytes(pendingFile.size)} ·{' '}
                  {pendingFile.type || 'file'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setPendingFile(null)}
                className="rounded-md p-0.5 text-ink-3 hover:bg-surface-hover hover:text-ink"
                aria-label="Remove attachment"
                title="Remove"
              >
                ✕
              </button>
            </div>
          )}
          <form
            onSubmit={handleSubmit}
            className="flex items-end gap-2 border-t border-line bg-surface-elev px-3 py-2.5"
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKey}
              placeholder={
                pendingFile
                  ? 'Add context (optional) — e.g. "this is for ARC001"…'
                  : 'Ask me anything · drop a receipt to log it…'
              }
              rows={2}
              maxLength={4000}
              disabled={pending}
              className="min-h-[42px] flex-1 resize-none rounded-md border border-line bg-card px-2 py-1.5 text-xs text-ink placeholder:text-ink-4 focus:border-brand focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={
                pending || (draft.trim().length === 0 && !pendingFile)
              }
              className="rounded-md bg-brand px-3 py-2 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? '…' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function AttachmentChips({ chips }: { chips: AttachmentChip[] }) {
  return (
    <ul className="mb-1.5 flex flex-col gap-1">
      {chips.map((a, i) => {
        const icon =
          a.status === 'uploading'
            ? '⋯'
            : a.status === 'extracting'
              ? '⋯'
              : a.status === 'failed'
                ? '⚠️'
                : '✓';
        return (
          <li
            key={i}
            className="flex items-center gap-1.5 text-[11px] text-white/85"
          >
            <span aria-hidden>📎</span>
            <span aria-hidden>{icon}</span>
            <span className="font-medium">{a.filename}</span>
            <span className="text-white/65">
              ·{' '}
              {a.status === 'uploading'
                ? 'uploading'
                : a.status === 'extracting'
                  ? 'extracting fields…'
                  : (a.summary ?? formatBytes(a.sizeBytes))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const PREFILL_LABEL: Record<string, string> = {
  timesheet: 'Open prefilled timesheet',
  expense: 'Open prefilled expense',
  bill: 'Open prefilled bill',
  invoice: 'Open prefilled invoice',
};

function ProposalCards({
  cards,
  onConfirm,
  onCancel,
}: {
  cards: ProposalCard[];
  onConfirm: (token: string, kind: string) => void;
  onCancel: (token: string) => void;
}) {
  return (
    <ul className="mt-1.5 flex flex-col gap-1.5">
      {cards.map((c) => {
        const kind =
          c.surface === 'recruit' ? 'recruit_proposal' : 'feedback_proposal';
        const confirmed = c.status === 'confirmed';
        const failed = c.status === 'failed';
        return (
          <li
            key={c.token}
            className="rounded-md border border-brand bg-brand/10 px-2.5 py-2 text-[11px] text-ink"
          >
            <div className="mb-1.5 font-semibold text-ink">{c.title}</div>
            <dl className="mb-2 grid grid-cols-[max-content,1fr] gap-x-2 gap-y-0.5">
              {c.fields.map((f, i) => (
                <div key={i} className="contents">
                  <dt className="text-ink-3">{f.label}</dt>
                  <dd className="whitespace-pre-wrap break-words text-ink">
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
            {failed && c.error ? (
              <div className="mb-1.5 text-status-red">⚠ {c.error}</div>
            ) : null}
            {confirmed && c.result ? (
              <div className="flex items-center gap-2 text-status-green">
                <span aria-hidden>✓</span>
                <span>{c.result.summary}</span>
                {c.result.link ? (
                  <a
                    href={c.result.link}
                    className="underline hover:opacity-80"
                  >
                    Open →
                  </a>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={c.status === 'confirming'}
                  onClick={() => onConfirm(c.token, kind)}
                  className="rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {c.status === 'confirming' ? '…' : c.confirmLabel}
                </button>
                <button
                  type="button"
                  disabled={c.status === 'confirming'}
                  onClick={() => onCancel(c.token)}
                  className="rounded-md border border-line bg-card px-2.5 py-1 text-[11px] font-medium text-ink-2 hover:bg-surface-hover hover:text-ink disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PrefillCards({
  cards,
  onOpen,
}: {
  cards: PrefillCard[];
  onOpen: () => void;
}) {
  return (
    <ul className="mt-1.5 flex flex-col gap-1.5">
      {cards.map((c, i) => (
        <li
          key={i}
          className="rounded-md border border-brand bg-brand/10 px-2.5 py-2 text-[11px] text-ink"
        >
          <div className="mb-1.5 leading-snug">{c.summary}</div>
          <a
            href={c.url}
            onClick={onOpen}
            className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90"
          >
            <span aria-hidden>✨</span>
            <span>{PREFILL_LABEL[c.surface] ?? `Open prefilled ${c.surface}`}</span>
            <span aria-hidden>→</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function ToolChips({ tools }: { tools: ToolInvocation[] }) {
  return (
    <ul className="mb-1.5 flex flex-col gap-1">
      {tools.map((t) => {
        const icon =
          t.status === 'running' ? '⋯' : t.status === 'ok' ? '✓' : '⚠️';
        const tone =
          t.status === 'failed'
            ? 'text-status-red'
            : t.status === 'ok'
              ? 'text-ink-3'
              : 'text-ink-3';
        return (
          <li
            key={t.id}
            className={`flex items-center gap-1.5 text-[11px] italic ${tone}`}
          >
            <span aria-hidden>{icon}</span>
            <span>{toolLabel(t.name)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 text-ink-3" aria-label="Assistant is typing">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-3" />
      <span
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-3"
        style={{ animationDelay: '0.15s' }}
      />
      <span
        className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-3"
        style={{ animationDelay: '0.3s' }}
      />
    </span>
  );
}

/**
 * Minimal markdown rendering tailored to the assistant's output:
 *   **bold**         → <strong>
 *   `inline code`    → <code>
 *   [label](url)     → <a>
 *   bare /paths      → auto-linked (the system prompt nudges Claude to
 *                      mention routes like /timesheet inline)
 *   bullet lines (- or *)
 *   paragraph breaks preserved
 *
 * Deliberately not a full markdown lib — react-markdown would be ~80kb
 * of dependencies for the four constructs that actually matter here.
 */
function AssistantMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="flex flex-col gap-1.5 whitespace-pre-wrap break-words leading-snug">
      {blocks.map((block, i) => {
        if (block.kind === 'list') {
          return (
            <ul key={i} className="list-disc pl-4">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return <div key={i}>{renderInline(block.text)}</div>;
      })}
    </div>
  );
}

type Block = { kind: 'text'; text: string } | { kind: 'list'; items: string[] };

function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const out: Block[] = [];
  let buf: string[] = [];
  let listBuf: string[] = [];

  const flushText = () => {
    if (buf.length === 0) return;
    out.push({ kind: 'text', text: buf.join('\n') });
    buf = [];
  };
  const flushList = () => {
    if (listBuf.length === 0) return;
    out.push({ kind: 'list', items: listBuf });
    listBuf = [];
  };

  for (const line of lines) {
    const m = /^\s*[-*]\s+(.+)$/.exec(line);
    if (m && m[1]) {
      flushText();
      listBuf.push(m[1]);
    } else {
      flushList();
      buf.push(line);
    }
  }
  flushText();
  flushList();
  return out;
}

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+|\/[a-zA-Z0-9_\-/[\]]+)/g;

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(INLINE_RE.source, 'g');
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={key++}
          className="rounded bg-card px-1 py-0.5 font-mono text-[11px]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('[')) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (m) {
        parts.push(
          <a
            key={key++}
            href={m[2]}
            target={m[2]?.startsWith('http') ? '_blank' : undefined}
            rel="noreferrer"
            className="text-brand underline hover:opacity-80"
          >
            {m[1]}
          </a>,
        );
      } else {
        parts.push(token);
      }
    } else if (token.startsWith('http')) {
      parts.push(
        <a
          key={key++}
          href={token}
          target="_blank"
          rel="noreferrer"
          className="text-brand underline hover:opacity-80"
        >
          {token}
        </a>,
      );
    } else if (token.startsWith('/')) {
      // In-app route — render as a Next-router link, but since we may
      // be inside a streaming bubble, a normal anchor is enough (same
      // tab, full navigation; the (app) layout re-hydrates).
      parts.push(
        <a
          key={key++}
          href={token}
          className="text-brand underline hover:opacity-80"
        >
          {token}
        </a>,
      );
    } else {
      parts.push(token);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}
