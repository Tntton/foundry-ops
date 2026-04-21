'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type SearchResult = {
  kind: 'project' | 'person' | 'client' | 'invoice' | 'bill' | 'deal';
  id: string;
  label: string;
  hint?: string;
  href: string;
};

const KIND_LABEL: Record<SearchResult['kind'], string> = {
  project: 'Projects',
  person: 'People',
  client: 'Clients',
  invoice: 'Invoices',
  bill: 'Bills',
  deal: 'Deals',
};

const KIND_ORDER: SearchResult['kind'][] = [
  'project',
  'person',
  'client',
  'deal',
  'invoice',
  'bill',
];

export function CommandPaletteTrigger() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setCursor(0);
    } else {
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setCursor(0);
      return;
    }
    let alive = true;
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (!alive) return;
        const json = await res.json();
        setResults((json.results ?? []) as SearchResult[]);
        setCursor(0);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setLoading(false);
      }
    }, 150);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [query]);

  // Build grouped index that maps linear cursor ↔ result index.
  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    items: results.filter((r) => r.kind === kind),
  })).filter((g) => g.items.length > 0);
  const flat = grouped.flatMap((g) => g.items);

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, flat.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = flat[cursor];
      if (pick) navigate(pick.href);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-surface-elev px-3 text-sm text-ink-3 hover:bg-surface-hover"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search…</span>
        <kbd className="ml-auto rounded border border-line bg-surface-subtle px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
          ⌘K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Search</DialogTitle>
          </DialogHeader>
          <div className="border-b border-line p-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-ink-3" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search projects, people, clients, invoices, bills, deals…"
                className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none"
              />
              {loading && <span className="text-xs text-ink-3">…</span>}
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {query.trim().length < 2 ? (
              <div className="p-6 text-center text-sm text-ink-3">
                Type at least 2 characters.
              </div>
            ) : flat.length === 0 && !loading ? (
              <div className="p-6 text-center text-sm text-ink-3">
                No matches for &quot;{query}&quot;.
              </div>
            ) : (
              grouped.map((group) => (
                <div key={group.kind}>
                  <div className="border-b border-line bg-surface-subtle px-3 py-1 text-[10px] uppercase tracking-wide text-ink-3">
                    {KIND_LABEL[group.kind]}
                  </div>
                  {group.items.map((r) => {
                    const flatIndex = flat.indexOf(r);
                    const active = flatIndex === cursor;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onMouseEnter={() => setCursor(flatIndex)}
                        onClick={() => navigate(r.href)}
                        className={`flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm ${
                          active
                            ? 'bg-surface-hover text-ink'
                            : 'text-ink-2 hover:bg-surface-hover'
                        }`}
                      >
                        <span className="truncate">{r.label}</span>
                        {r.hint && (
                          <span className="shrink-0 text-xs text-ink-3">{r.hint}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="border-t border-line bg-surface-subtle px-3 py-2 text-[10px] text-ink-3">
            <span className="mr-3">
              <kbd className="rounded border border-line bg-surface-elev px-1">↑</kbd>{' '}
              <kbd className="rounded border border-line bg-surface-elev px-1">↓</kbd>{' '}
              move
            </span>
            <span className="mr-3">
              <kbd className="rounded border border-line bg-surface-elev px-1">↵</kbd> open
            </span>
            <span>
              <kbd className="rounded border border-line bg-surface-elev px-1">Esc</kbd>{' '}
              close
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
