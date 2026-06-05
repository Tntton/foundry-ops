'use client';

import { useMobileNav } from './mobile-nav';

/**
 * Hamburger button rendered in the topbar on mobile only. Click → opens
 * the sidebar drawer (which lives under <MobileNavProvider> in the
 * layout). Hidden on `md+` since the sidebar is always visible there.
 */
export function MobileNavTrigger() {
  const { open, setOpen } = useMobileNav();
  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-label={open ? 'Close menu' : 'Open menu'}
      aria-expanded={open}
      className="-ml-2 inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-hover hover:text-ink md:hidden"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>
  );
}
