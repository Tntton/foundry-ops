import Link from 'next/link';
import type { Role } from '@prisma/client';
import { filterNavForRoles } from '@/components/shell/nav-config';
import { cn } from '@/lib/utils';

export function Sidebar({
  roles,
  currentPath,
}: {
  roles: readonly Role[];
  currentPath: string;
}) {
  const groups = filterNavForRoles(roles);
  return (
    <aside className="flex h-screen w-[240px] shrink-0 flex-col gap-6 border-r border-line bg-surface-subtle px-3 py-4">
      <div className="px-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-primary-foreground">
            F
          </span>
          <span className="text-sm font-semibold text-ink">Foundry Ops</span>
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
                const active = currentPath === item.href || currentPath.startsWith(`${item.href}/`);
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
                      {item.badge && (
                        <span className="ml-auto rounded-full bg-status-amber-soft px-1.5 py-0.5 text-[10px] font-medium text-status-amber">
                          {item.badge}
                        </span>
                      )}
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
