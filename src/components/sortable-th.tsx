'use client';

import Link from 'next/link';
import { useSearchParams, usePathname } from 'next/navigation';
import { TableHead } from '@/components/ui/table';

/**
 * Shared sort-link logic. Used inside SortableTh (table mode) and
 * SortablePill (card-list mode — for pages that render cards instead
 * of table rows, so a thead pattern doesn't apply).
 */
function useSortHref(sortKey: string): {
  href: string;
  isActive: boolean;
  arrow: string;
  arrowOpacity: string;
} {
  const params = useSearchParams();
  const pathname = usePathname();
  const currentSort = params.get('sort');
  const currentDir = params.get('dir');
  const isActive = currentSort === sortKey;
  const nextDir =
    !isActive ? 'asc' : currentDir === 'asc' ? 'desc' : null;
  const next = new URLSearchParams(params.toString());
  if (nextDir === null) {
    next.delete('sort');
    next.delete('dir');
  } else {
    next.set('sort', sortKey);
    next.set('dir', nextDir);
  }
  return {
    href: `${pathname}?${next.toString()}`,
    isActive,
    arrow: isActive ? (currentDir === 'asc' ? '▲' : '▼') : '↕',
    arrowOpacity: isActive ? 'opacity-100' : 'opacity-30',
  };
}

/**
 * Sortable pill for use ABOVE a card list (when there's no <table>
 * to put column headers in). Visually a row of small chip-style
 * buttons, one per sort key. Same URL-param mechanism as SortableTh
 * so the two stay consistent.
 */
export function SortablePill({
  sortKey,
  children,
}: {
  sortKey: string;
  children: React.ReactNode;
}) {
  const { href, isActive, arrow, arrowOpacity } = useSortHref(sortKey);
  return (
    <Link
      href={href}
      scroll={false}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
        isActive
          ? 'border-brand bg-brand/10 text-ink'
          : 'border-line bg-surface-elev text-ink-3 hover:bg-surface-hover hover:text-ink'
      }`}
    >
      <span>{children}</span>
      <span aria-hidden className={`text-[9px] tabular-nums ${arrowOpacity}`}>
        {arrow}
      </span>
    </Link>
  );
}

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
  const { href, arrow, arrowOpacity } = useSortHref(sortKey);
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
