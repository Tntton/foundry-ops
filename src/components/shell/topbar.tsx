import Link from 'next/link';
import { LayoutGrid } from 'lucide-react';
import type { Role } from '@prisma/client';
import { Breadcrumb } from '@/components/shell/breadcrumb';
import { CommandPaletteTrigger } from '@/components/shell/command-palette-trigger';
import { UserMenu } from '@/components/shell/user-menu';
import { MobileNavTrigger } from '@/components/shell/mobile-nav-trigger';

export function Topbar({
  initials,
  displayName,
  email,
  headshotUrl,
  roles,
  viewAsChoices,
  viewAsRoles,
}: {
  initials: string;
  displayName: string;
  email: string;
  headshotUrl: string | null;
  /** Effective roles after any view-as overlay. Surfaced under the
   *  name/email in the user menu pill so the signed-in person can see
   *  their permission level at a glance. */
  roles: readonly Role[];
  /** Single-role overlays this person may preview (already clamped to
   *  strict capability downgrades server-side). Empty → no picker. */
  viewAsChoices: Role[];
  /** Active overlay (or null). Drives the "Exit view-as" affordance. */
  viewAsRoles: Role[] | null;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-elev px-3 md:gap-4 md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Mobile hamburger — opens the sidebar drawer. md:hidden so the
            desktop layout doesn't render it. */}
        <MobileNavTrigger />
        {/* Breadcrumb hides on tiny viewports — ⌘K + UserMenu have
            absolute priority on a phone. Still visible on `sm` and up. */}
        <div className="hidden min-w-0 sm:block">
          <Breadcrumb />
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        {/* Platform overview — the role × capability access matrix any
            user can refer to. Sits beside the search trigger; icon-only
            on narrow viewports where the palette + user menu take
            priority. */}
        <Link
          href="/platform-overview"
          title="Platform overview"
          className="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-surface-elev px-3 text-sm text-ink-3 hover:bg-surface-hover"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Overview</span>
        </Link>
        <CommandPaletteTrigger />
        <UserMenu
          initials={initials}
          displayName={displayName}
          email={email}
          headshotUrl={headshotUrl}
          roles={roles}
          viewAsChoices={viewAsChoices}
          viewAsRoles={viewAsRoles}
        />
      </div>
    </header>
  );
}
