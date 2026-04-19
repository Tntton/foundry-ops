'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Placeholder ⌘K trigger — shows a dialog saying "coming in Phase 2" so the
 * keyboard shortcut is reserved and visible in the UI, without building the
 * actual search backend yet.
 */
export function CommandPaletteTrigger() {
  const [open, setOpen] = useState(false);

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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Command palette</DialogTitle>
            <DialogDescription>
              Coming in Phase 2. You&apos;ll be able to jump to any project, log an
              expense, or draft an invoice from here.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
