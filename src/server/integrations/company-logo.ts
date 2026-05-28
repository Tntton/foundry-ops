/**
 * Company-website + logo resolution helpers.
 *
 * Used by Client / Contractor / Supplier surfaces. The product decision
 * (TT, 2026-05-10) is:
 *
 *   - operators record the public website (full URL) as the canonical
 *     field. Everything else is derived.
 *   - the company "domain" is just the host portion of the website,
 *     stripped of `www.`.
 *   - the logo URL is `https://logo.clearbit.com/{domain}` — Clearbit's
 *     free, unauthenticated logo service. Frontend renders it inside
 *     an `<img onError>` fallback so a 404 (Clearbit doesn't have the
 *     logo) gracefully degrades to initials.
 *   - when the website is missing, we infer it best-effort from the
 *     primary contact email (e.g. `proc@example.com.au` → website
 *     `https://example.com.au`). Operators can override on the edit
 *     form if the inference is wrong (consultant @ gmail.com etc).
 *
 * Free-mail providers + numeric-IP hosts are filtered so we don't ship
 * logos for "gmail.com" or "1.2.3.4". The blocklist is intentionally
 * short — fancy classification is overkill for the operator review
 * step that happens immediately after.
 */

// Hosts that should never seed a "company website" inference. Includes:
//   - Free-mail / consumer ISP providers (gmail, outlook, bigpond …) —
//     we only want corporate domains.
//   - The firm's own domain (foundry.health) — contractors paid via
//     a foundry.health email aren't billing from our domain, so the
//     inference would be misleading. Operators set the actual
//     consulting business website on the contractor edit form.
const FREE_MAIL_HOSTS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.com.au',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'live.com.au',
  'icloud.com',
  'me.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'msn.com',
  'bigpond.com',
  'bigpond.net.au',
  'optusnet.com.au',
  'iinet.net.au',
  'tpg.com.au',
  'internode.on.net',
  // Foundry's own domain — never use it as a contractor's company
  // signal.
  'foundry.health',
]);

/**
 * Extract a usable host from a free-form website string.
 *
 * Accepts inputs the operator might paste:
 *   "https://www.example.com.au/about"  → "example.com.au"
 *   "example.com.au"                    → "example.com.au"
 *   "WWW.Example.com"                   → "example.com"
 *   "  https://foo.io/  "               → "foo.io"
 *   ""                                  → null
 *
 * Returns null for plainly invalid input (numeric IPs, single-label
 * hosts like "localhost", anything with no dot).
 */
export function domainFromWebsite(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // URL constructor needs a protocol. Add one if missing so we can use
  // it to extract `host` consistently.
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let host: string;
  try {
    const url = new URL(withProto);
    host = url.host;
  } catch {
    return null;
  }

  host = host.toLowerCase();
  // Strip leading www. so "www.example.com" and "example.com" produce
  // the same logo URL.
  if (host.startsWith('www.')) host = host.slice(4);
  // Drop port if present.
  const colon = host.indexOf(':');
  if (colon >= 0) host = host.slice(0, colon);

  if (!host) return null;
  // Reject single-label hosts (no TLD) and IPv4 literals — Clearbit
  // doesn't have logos for those and storing them is misleading.
  if (!host.includes('.')) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  return host;
}

/**
 * Pull the host from an email address, with the free-mail blocklist
 * applied. Returns null when the address is malformed, doesn't have a
 * host part, or is from a personal-email provider.
 */
export function domainFromEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  const host = trimmed.slice(at + 1);
  if (!host.includes('.')) return null;
  if (FREE_MAIL_HOSTS.has(host)) return null;
  return host;
}

/**
 * Compose a Clearbit logo URL for a given host. Caller is responsible
 * for handling a 404 at render time (use `<img onError>`).
 */
export function clearbitLogoUrl(domain: string | null): string | null {
  if (!domain) return null;
  return `https://logo.clearbit.com/${domain}`;
}

/**
 * Normalise an operator-pasted website into a canonical form
 * (`https://example.com.au`). Strips trailing slashes, lowercases the
 * host, preserves the path if the operator pasted one (rare but
 * possible — e.g. an org with a sub-page as their landing).
 *
 * Returns null when the input is empty or unparseable.
 */
export function canonicaliseWebsite(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    return null;
  }
  // Force https for the canonical form — almost everyone redirects to
  // it anyway, and storing a mix of http/https makes equality checks
  // fiddly. Operators can paste an http URL but it'll be normalised.
  url.protocol = 'https:';
  let host = url.host.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  url.host = host;
  // Strip trailing slash on the path so `https://x.com/` and
  // `https://x.com` collapse together.
  let canonical = url.toString();
  if (canonical.endsWith('/') && url.pathname === '/') canonical = canonical.slice(0, -1);
  return canonical;
}

/**
 * One-shot: take any operator input (website OR email) and produce the
 * stored triple. Useful from server actions — the form passes whatever
 * the operator typed and we figure out the rest.
 *
 * If both `website` and `email` are passed, `website` wins.
 */
export function resolveCompanyAssets(opts: {
  website?: string | null;
  email?: string | null;
}): { website: string | null; domain: string | null; logoUrl: string | null } {
  let domain = domainFromWebsite(opts.website);
  if (!domain) domain = domainFromEmail(opts.email);
  const website = opts.website ? canonicaliseWebsite(opts.website) : domain ? `https://${domain}` : null;
  const logoUrl = clearbitLogoUrl(domain);
  return { website, domain, logoUrl };
}
