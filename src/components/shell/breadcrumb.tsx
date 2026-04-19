'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { NAV_GROUPS } from '@/components/shell/nav-config';

function humanise(segment: string): string {
  const label = segment.replace(/[-_]/g, ' ').trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function labelForHref(href: string): string | undefined {
  for (const group of NAV_GROUPS) {
    const match = group.items.find((i) => i.href === href);
    if (match) return match.label;
  }
  return undefined;
}

export function Breadcrumb() {
  const pathname = usePathname();
  if (pathname === '/') {
    return <span className="text-sm text-ink-2">Dashboard</span>;
  }

  const parts = pathname.split('/').filter(Boolean);
  const crumbs = parts.map((part, i) => {
    const href = `/${parts.slice(0, i + 1).join('/')}`;
    return {
      href,
      label: labelForHref(href) ?? humanise(part),
    };
  });

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-ink-2">
      <Link href="/" className="text-ink-3 hover:text-ink">
        Home
      </Link>
      {crumbs.map((c, i) => (
        <span key={c.href} className="flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-ink-4" />
          {i === crumbs.length - 1 ? (
            <span className="text-ink">{c.label}</span>
          ) : (
            <Link href={c.href} className="text-ink-3 hover:text-ink">
              {c.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
