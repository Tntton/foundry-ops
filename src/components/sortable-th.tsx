'use client';

import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';
import { TableHead } from '@/components/ui/table';

/**
 * Sortable table header. Drop-in for `<TableHead>` — clicking the
 * header toggles ascending → descending → unsorted. State lives in
 * URL search params (`?sort=lastName&dir=desc`) so it's shareable,
 * browser-back works, and the server can read it.
 *
 * Pass a stable `sortKey` matching whatever value the server-side
 * `listPeople`/`listClients` etc. accepts for ordering.
 */
export function SortableTh({
  sortKey,
  children,
  className,
  align = 'left',
}: {
  sortKey: string;
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right';
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const currentSort = params.get('sort');
  const currentDir = params.get('dir');
  const isActive = currentSort === sortKey;
  const nextDir =
    !isActive ? 'asc' : currentDir === 'asc' ? 'desc' : null;

  // Build the next URL: copy existing params, update sort + dir.
  const next = new URLSearchParams(params.toString());
  if (nextDir === null) {
    next.delete('sort');
    next.delete('dir');
  } else {
    next.set('sort', sortKey);
    next.set('dir', nextDir);
  }
  const href = `${pathname}?${next.toString()}`;

  const arrow = isActive ? (currentDir === 'asc' ? '▲' : '▼') : '↕';
  const arrowOpacity = isActive ? 'opacity-100' : 'opacity-30';
  return (
    <TableHead className={className}>
      <Link
        href={href}
        scroll={false}
        className={`group inline-flex items-center gap-1 ${
          align === 'right' ? 'flex-row-reverse' : ''
        } hover:text-ink`}
      >
        <span>{children}</span>
        <span
          aria-hidden
          className={`text-[9px] tabular-nums transition-opacity group-hover:opacity-100 ${arrowOpacity}`}
        >
          {arrow}
        </span>
      </Link>
    </TableHead>
  );
}
