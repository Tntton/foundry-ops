'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { Role } from '@prisma/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { signOutAction } from '@/app/(app)/me/signout-action';
import { setViewAsRoles } from '@/app/(app)/me/view-as-action';

/**
 * Topbar avatar + name pill that opens a small dropdown with "My
 * profile", a super-admin "View as" submenu, and "Sign out". Built
 * without a popover library — just useState + outside-click handler.
 *
 * Profile picture: `headshotUrl` drives the avatar image; falls back to
 * the person's initials when unset.
 *
 * View-as: only shown when the underlying user is a real super_admin.
 * Setting an overlay reloads the view (cookie + revalidate) so the
 * sidebar / pages immediately reflect the pretended role-set; an
 * "Exit view-as" item replaces the picker while the overlay is active.
 */

const VIEW_AS_OPTIONS: Array<{ label: string; roles: Role[] }> = [
  { label: 'Admin', roles: ['admin'] },
  { label: 'Partner', roles: ['partner'] },
  { label: 'Manager', roles: ['manager'] },
  { label: 'Staff', roles: ['staff'] },
];

/**
 * Map a Role to its human-readable label. Super-admin gets a hyphen
 * so it reads cleanly in sentence case ("Super-admin").
 */
const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super-admin',
  admin: 'Admin',
  partner: 'Partner',
  associate_partner: 'Associate Partner',
  manager: 'Manager',
  staff: 'Staff',
};

const ROLE_PRECEDENCE: readonly Role[] = [
  'super_admin',
  'admin',
  'partner',
  'manager',
  'staff',
];

/**
 * Format a role-set as a sentence-case string. Returns the highest-
 * precedence role first; secondary roles get appended in parens
 * ("Super-admin · Partner") so partners with admin hats are visible.
 */
function formatRoles(roles: readonly Role[]): string {
  if (roles.length === 0) return '—';
  const sorted = [...roles].sort(
    (a, b) => ROLE_PRECEDENCE.indexOf(a) - ROLE_PRECEDENCE.indexOf(b),
  );
  const primary = ROLE_LABEL[sorted[0]!];
  if (sorted.length === 1) return primary;
  const extras = sorted.slice(1).map((r) => ROLE_LABEL[r]);
  return `${primary} · ${extras.join(' · ')}`;
}

export function UserMenu({
  initials,
  displayName,
  email,
  headshotUrl,
  roles,
  isRealSuperAdmin,
  viewAsRoles,
}: {
  initials: string;
  displayName: string;
  email: string;
  headshotUrl: string | null;
  roles: readonly Role[];
  isRealSuperAdmin: boolean;
  viewAsRoles: Role[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [viewAsPending, startViewAsTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  function applyViewAs(roles: Role[] | null) {
    startViewAsTransition(async () => {
      const result = await setViewAsRoles(roles);
      if (result.ok) {
        setOpen(false);
        // Hard reload so server-rendered components (sidebar, page
        // permission gates) re-read the session cookie. revalidatePath
        // alone doesn't always re-render client components reliably.
        if (typeof window !== 'undefined') window.location.reload();
      }
    });
  }

  // Tolerate `undefined` defensively — during HMR / initial client
  // hydration the prop may briefly arrive without a value before the
  // server-rendered tree replaces it.
  const activeRoles: Role[] | null = viewAsRoles ?? null;
  const isViewing = activeRoles !== null && activeRoles.length > 0;
  const viewAsLabel = isViewing
    ? VIEW_AS_OPTIONS.find(
        (o) =>
          o.roles.length === activeRoles!.length &&
          o.roles.every((r) => activeRoles!.includes(r)),
      )?.label ?? activeRoles!.join(' + ')
    : null;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="User menu"
        className={`flex items-center gap-2 rounded-md px-2 py-1 -mx-2 transition-colors ${
          open ? 'bg-surface-hover' : 'hover:bg-surface-hover'
        }`}
      >
        <div className="hidden text-right sm:block">
          <div className="text-sm font-medium leading-tight text-ink">
            {displayName}
          </div>
          <div className="font-mono text-[11px] leading-tight text-ink-3">
            {email}
          </div>
          <div
            className={`text-[10px] font-semibold uppercase tracking-wider leading-tight ${
              isViewing ? 'text-status-amber' : 'text-ink-3'
            }`}
          >
            {isViewing
              ? `Viewing as ${viewAsLabel}`
              : formatRoles(roles)}
          </div>
        </div>
        <Avatar
          className={`h-8 w-8 ${
            isViewing ? 'ring-2 ring-status-amber ring-offset-1' : ''
          }`}
        >
          {headshotUrl && (
            <AvatarImage src={headshotUrl} alt={displayName} />
          )}
          <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
        </Avatar>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-md border border-line bg-card shadow-lg"
        >
          <div className="border-b border-line px-3 py-2">
            <div className="text-sm font-medium text-ink">{displayName}</div>
            <div className="font-mono text-[11px] text-ink-3">{email}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              {formatRoles(roles)}
            </div>
            {isViewing && (
              <div className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-status-amber bg-status-amber-soft px-2 py-0.5 text-[10px] text-status-amber">
                Viewing as {viewAsLabel}
              </div>
            )}
          </div>
          <Link
            href="/me"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            My profile
          </Link>

          {isRealSuperAdmin && (
            <div className="border-t border-line bg-surface-subtle/40">
              <div className="px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                View as
              </div>
              <div className="px-1 py-1">
                {VIEW_AS_OPTIONS.map((opt) => {
                  const isCurrent =
                    isViewing &&
                    opt.roles.length === activeRoles!.length &&
                    opt.roles.every((r) => activeRoles!.includes(r));
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      role="menuitem"
                      disabled={viewAsPending || isCurrent}
                      onClick={() => applyViewAs(opt.roles)}
                      className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-sm transition-colors ${
                        isCurrent
                          ? 'bg-status-amber-soft text-status-amber'
                          : 'text-ink-2 hover:bg-surface-hover hover:text-ink'
                      } disabled:cursor-not-allowed`}
                    >
                      <span>{opt.label}</span>
                      {isCurrent && (
                        <span className="text-[10px] uppercase tracking-wide">
                          Active
                        </span>
                      )}
                    </button>
                  );
                })}
                {isViewing && (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={viewAsPending}
                    onClick={() => applyViewAs(null)}
                    className="mt-1 flex w-full items-center justify-between rounded border-t border-line px-2 py-1.5 text-sm text-status-red hover:bg-status-red-soft disabled:opacity-60"
                  >
                    <span>
                      {viewAsPending ? 'Exiting…' : 'Exit view-as mode'}
                    </span>
                  </button>
                )}
              </div>
              <p className="px-3 pb-2 text-[10px] text-ink-3">
                Overlays the role-set across the app for review.
                Mutations are still attributed to your real account in
                the audit log.
              </p>
            </div>
          )}

          <form
            action={() => {
              startTransition(async () => {
                await signOutAction();
              });
            }}
            className="contents"
          >
            <button
              type="submit"
              role="menuitem"
              disabled={pending}
              className="block w-full border-t border-line px-3 py-2 text-left text-sm text-status-red hover:bg-status-red-soft disabled:opacity-60"
            >
              {pending ? 'Signing out…' : 'Sign out'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
