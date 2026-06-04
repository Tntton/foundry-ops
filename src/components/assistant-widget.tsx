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
type Message = {
  id: string;
  role: Role;
  content: string;
  /** True while a streaming response is still being appended. */
  streaming?: boolean;
};

const PLACEHOLDER =
  "Hey — I'm the Foundry Ops assistant. Ask me how to log hours, where approvals live, or which screen does X. I keep answers short.";

/**
 * Floating in-app assistant. Lives at the bottom-right of every authed
 * page (mounted from `(app)/layout.tsx`). Click the pill → expanded
 * panel. Powered by Claude via `/api/assistant/chat`, streamed via SSE.
 *
 * Phase 1 (TASK-300) — conversational helper only, no tools / writes.
 */
export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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
        setError("Couldn't load conversation — refresh and try again.");
        setHydrated(true);
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
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || pending) return;
      setError(null);
      setDraft('');

      const userMsg: Message = {
        id: `local-${Date.now()}-u`,
        role: 'user',
        content: trimmed,
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
        const res = await fetch('/api/assistant/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed }),
          signal: ac.signal,
        });

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
            let evt: { kind: string; text?: string; finalText?: string; message?: string };
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
            } else if (evt.kind === 'error' && evt.message) {
              setError(evt.message);
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
    void sendMessage(draft);
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a newline. ⌘/Ctrl+Enter also sends.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(draft);
    }
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
          className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full border border-brand bg-brand px-3 py-2 text-xs font-medium text-brand-ink shadow-lg transition-all hover:opacity-90"
          title="Ask the Foundry Ops assistant"
        >
          <span aria-hidden>✨</span>
          <span>Assistant</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-4 right-4 z-40 flex h-[600px] w-[400px] max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-line bg-card shadow-2xl">
          <header className="flex items-center justify-between gap-2 border-b border-line bg-surface-elev px-4 py-2.5">
            <div>
              <div className="text-sm font-semibold text-ink">
                Assistant{' '}
                <span className="font-normal text-ink-3">· helps you move fast</span>
              </div>
              <div className="text-[11px] text-ink-3">
                Asks short, point-and-go answers. Phase 1: guidance only.
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
              <div className="rounded-lg border border-dashed border-line bg-surface-elev px-3 py-4 text-center text-xs text-ink-3">
                {PLACEHOLDER}
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
                          ? 'max-w-[85%] rounded-lg bg-brand px-3 py-2 text-xs text-brand-ink'
                          : 'max-w-[90%] rounded-lg bg-surface-elev px-3 py-2 text-xs text-ink'
                      }
                    >
                      {m.content.length > 0 ? (
                        <AssistantMarkdown text={m.content} />
                      ) : m.streaming ? (
                        <TypingDots />
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

          <form
            onSubmit={handleSubmit}
            className="flex items-end gap-2 border-t border-line bg-surface-elev px-3 py-2.5"
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask me anything about Foundry Ops…"
              rows={2}
              maxLength={4000}
              disabled={pending}
              className="min-h-[42px] flex-1 resize-none rounded-md border border-line bg-card px-2 py-1.5 text-xs text-ink placeholder:text-ink-4 focus:border-brand focus:outline-none disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={pending || draft.trim().length === 0}
              className="rounded-md bg-brand px-3 py-2 text-xs font-medium text-brand-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {pending ? '…' : 'Send'}
            </button>
          </form>
        </div>
      )}
    </>
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
