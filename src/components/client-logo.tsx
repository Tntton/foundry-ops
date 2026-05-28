'use client';

import { useState } from 'react';

/**
 * Client logo, sourced from Clearbit's free logo CDN
 * (`https://logo.clearbit.com/{domain}`). No API key required for the
 * logo endpoint. Domain is inferred from a stored `domain` (preferred),
 * `billingEmail`, or a slugified legal name as a last resort.
 *
 * On any image-load failure (Clearbit doesn't have the brand, network
 * blocks the call, etc.) we fall back to a round-tile glyph showing
 * the first letter of the legal name. So the UI always renders
 * something, even for clients Clearbit doesn't recognise.
 *
 * `<img>` rather than `next/image` because Clearbit doesn't list well-
 * known dimensions and the next/image domain allowlist would need
 * wiring up for the same effect — the file is tiny either way.
 */

const COMPANY_STOPWORDS = new Set([
  'pty',
  'ltd',
  'limited',
  'llc',
  'inc',
  'incorporated',
  'corp',
  'co',
  'company',
  'capital',
  'partners',
  'ventures',
  'group',
  'foundation',
  'holdings',
  'health',
  'the',
  'and',
  '&',
]);

/**
 * Best-effort domain inference from a client's legal name when no
 * structured `domain` or `billingEmail` is available. Lowercases,
 * strips punctuation + corporate stopwords, joins remaining tokens
 * directly, and tries `.com`. Operators can later store the correct
 * domain on `Client.domain` to override (TBD schema).
 */
export function inferDomainFromName(legalName: string): string | null {
  const tokens = legalName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !COMPANY_STOPWORDS.has(t));
  if (tokens.length === 0) return null;
  const slug = tokens.join('');
  if (slug.length < 2) return null;
  return `${slug}.com`;
}

export function inferDomain(opts: {
  domain?: string | null;
  billingEmail?: string | null;
  legalName: string;
}): string | null {
  if (opts.domain && opts.domain.includes('.')) return opts.domain;
  if (opts.billingEmail) {
    const at = opts.billingEmail.indexOf('@');
    if (at > -1) {
      const d = opts.billingEmail.slice(at + 1).trim();
      if (d.length >= 3 && d.includes('.')) return d;
    }
  }
  return inferDomainFromName(opts.legalName);
}

export function ClientLogo({
  legalName,
  domain,
  billingEmail,
  size = 28,
  className,
}: {
  legalName: string;
  domain?: string | null;
  billingEmail?: string | null;
  size?: number;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const resolved = inferDomain({ domain, billingEmail, legalName });
  const initial = legalName.charAt(0).toUpperCase() || '?';
  const showFallback = errored || !resolved;

  if (showFallback) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-md bg-surface-subtle font-semibold text-ink-3 ${className ?? ''}`}
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.45),
        }}
        aria-label={`${legalName} (no logo)`}
      >
        {initial}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://logo.clearbit.com/${resolved}?size=${size * 2}`}
      alt={`${legalName} logo`}
      width={size}
      height={size}
      onError={() => setErrored(true)}
      className={`inline-block shrink-0 rounded-md bg-white object-contain ring-1 ring-line ${className ?? ''}`}
      style={{ width: size, height: size }}
      loading="lazy"
    />
  );
}
