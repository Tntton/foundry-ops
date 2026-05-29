'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role, Band } from '@prisma/client';
import { filterNavForRoles } from '@/components/shell/nav-config';
import { cn } from '@/lib/utils';

export function Sidebar({
  roles,
  band,
  badges,
}: {
  roles: readonly Role[];
  /** Person.band of the signed-in user — used to apply nav-item `denyBands`
   *  filters (e.g. Support_Staff don't see delivery-side surfaces even when
   *  they hold an admin role). */
  band?: Band | null;
  /** Optional dynamic badges keyed by nav-item href — overrides any
   *  static `badge` on the item. Today this surfaces the unread
   *  UserUpdate count next to "Dashboard". */
  badges?: Record<string, number | undefined>;
}) {
  // Live client-side pathname — without this the sidebar's active state
  // would only update on full reload (it was previously a server
  // component reading `x-pathname` from headers, which Next 14 doesn't
  // set without middleware, so the highlight got stuck on Dashboard).
  const pathname = usePathname() ?? '/';
  const groups = filterNavForRoles(roles, band);

  return (
    <aside className="flex h-screen w-[240px] shrink-0 flex-col gap-6 border-r border-line bg-surface-subtle px-3 py-4">
      <div className="px-3">
        <Link
          href="/"
          className="flex flex-col items-start gap-1"
          aria-label="Foundry Health · Ops Platform home"
        >
          {/* Official FH lockup. Plain <img> so the public asset path
              doesn't get tree-shaken; PNG is small (~20kb). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/fh-lockup-black.png"
            alt="Foundry Health"
            className="h-5 w-auto select-none"
          />
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-ink-3">
            Ops Platform
          </span>
        </Link>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto">
        {groups.map((group) => (
          <div key={group.id}>
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                // Dashboard ('/') is special — startsWith would match
                // every path, so highlight only on exact match. Every
                // other item highlights on its prefix so /projects/IFM001
                // still lights up "Projects".
                const active =
                  item.href === '/'
                    ? pathname === '/'
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
                        active
                          ? 'bg-brand-soft text-brand-ink'
                          : 'text-ink-2 hover:bg-surface-hover hover:text-ink',
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                      {(() => {
                        const dyn = badges?.[item.href];
                        const showDyn = typeof dyn === 'number' && dyn > 0;
                        if (showDyn) {
                          return (
                            <span className="ml-auto rounded-full bg-status-amber px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {dyn > 99 ? '99+' : dyn}
                            </span>
                          );
                        }
                        if (item.badge) {
                          return (
                            <span className="ml-auto rounded-full bg-status-amber-soft px-1.5 py-0.5 text-[10px] font-medium text-status-amber">
                              {item.badge}
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-line px-3 pt-3 text-[10px] text-ink-4">
        <span className="font-mono">foundry.health</span>
      </div>
    </aside>
  );
}
