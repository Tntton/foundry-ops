'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';

/**
 * Shared open-state for the mobile sidebar drawer. Used by:
 *   - the layout, which wraps everything in <MobileNavProvider>
 *   - the topbar, whose hamburger button calls setOpen(true)
 *   - the sidebar, which renders as a fixed overlay drawer when
 *     `open` is true (mobile only) OR as a normal flex aside (desktop)
 *
 * Auto-closes on every route change — without this, navigating from
 * one nav link to another would leave the drawer open over the new
 * page (annoying on a small viewport).
 */

type MobileNavCtx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
};

const Ctx = createContext<MobileNavCtx | null>(null);

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const value = useMemo<MobileNavCtx>(
    () => ({ open, setOpen, toggle }),
    [open, toggle],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMobileNav(): MobileNavCtx {
  const v = useContext(Ctx);
  if (!v) {
    // Permissive fallback — server-render path / outside the provider
    // gets a no-op object so child components don't crash. The real
    // state only matters once hydration kicks in.
    return {
      open: false,
      setOpen: () => undefined,
      toggle: () => undefined,
    };
  }
  return v;
}
