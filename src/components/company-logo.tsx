'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Renders a company logo (Clearbit-resolved or operator-overridden)
 * with a graceful fallback to initials when:
 *   - the URL is null
 *   - Clearbit returned a 404 (logo not on file)
 *
 * Mirrors `<PersonAvatar>` but for organisations. Used by the Client,
 * Contractor (company), and Supplier surfaces.
 */
export function CompanyLogo({
  src,
  name,
  className,
  fallbackClassName,
}: {
  src: string | null | undefined;
  name: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const [broken, setBroken] = useState(false);
  const initials = computeInitials(name);
  if (!src || broken) {
    return (
      <div
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface-subtle text-[11px] font-semibold uppercase tracking-wide text-ink-2',
          className,
          fallbackClassName,
        )}
        aria-label={`${name} logo placeholder`}
      >
        {initials}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={`${name} logo`}
      onError={() => setBroken(true)}
      className={cn(
        'h-9 w-9 rounded-md border border-line bg-white object-contain p-1',
        className,
      )}
    />
  );
}

function computeInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '·';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
