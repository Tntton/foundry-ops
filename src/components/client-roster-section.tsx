import Link from 'next/link';
import type { ClientRosterRow } from '@/server/client-roster';
import { ClientLogo } from '@/components/client-logo';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  // Compact dollars — $1.2m / $850k / $9.4k — keeps the column tight
  // since the roster is a glance-and-scan view, not a working ledger.
  const dollars = cents / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}m`;
  if (Math.abs(dollars) >= 1_000) return `$${(dollars / 1_000).toFixed(0)}k`;
  return `$${dollars.toFixed(0)}`;
}

function formatClientType(t: string): string {
  return t
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

/**
 * Active client roster — every client with BD or project activity in
 * the last 12 months (LTM). Lives on `/directory/clients` (was on
 * the People tab; moved per TT, 2026-05-10). Dormant rows are filtered
 * out by default — an "Include dormant" toggle is the caller's choice
 * (we just render whatever rows we're handed). Sort upstream is by
 * lastWorkAt desc.
 */
export function ClientRosterSection({
  rows,
  title = 'Active client roster',
  subtitle = 'Active = BD or project activity in the last 365 days. Dormant rows hidden — operator can re-activate via /directory/clients?archived=1.',
}: {
  rows: ClientRosterRow[];
  title?: string;
  subtitle?: string;
}) {
  const flaggedCount = rows.filter((r) => r.notWorkedInLtm).length;
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {title} · {rows.length}
          </h2>
          <p className="text-[10px] text-ink-3">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          {flaggedCount > 0 && (
            <Badge variant="amber" className="text-[10px]">
              {flaggedCount} dormant
            </Badge>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-ink-3">
          No active clients — every client either has no work in the
          last 365 days, or is archived.{' '}
          <Link
            href="/directory/clients?archived=1"
            className="text-brand hover:underline"
          >
            Show archived
          </Link>
          .
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-subtle text-[10px] uppercase tracking-wide text-ink-3">
              <tr className="border-b border-line">
                <th className="px-3 py-1.5 text-left">Client</th>
                <th className="px-3 py-1.5 text-left">Type</th>
                <th className="px-3 py-1.5 text-right">Projects</th>
                <th className="px-3 py-1.5 text-left">Last project</th>
                <th className="px-3 py-1.5 text-right">LTM</th>
                <th className="px-3 py-1.5 text-right">Lifetime</th>
                <th className="px-3 py-1.5 text-left">Last work</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className={`border-b border-line last:border-b-0 ${
                    r.notWorkedInLtm ? 'bg-status-amber-soft/25' : ''
                  }`}
                >
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/directory/clients/${r.id}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <ClientLogo
                        legalName={r.legalName}
                        domain={r.domain}
                        billingEmail={r.billingEmail}
                        size={22}
                      />
                      <span className="flex flex-col leading-tight">
                        <span className="text-ink">{r.legalName}</span>
                        <span className="font-mono text-[10px] text-ink-3">
                          {r.code}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-[11px] text-ink-2">
                    {formatClientType(r.clientType)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    <span className="text-ink">{r.projects.length}</span>
                    {r.projects.length > 0 && (
                      <span className="ml-1 inline-flex flex-wrap justify-end gap-1">
                        {r.projects.slice(0, 3).map((p) => (
                          <Link
                            key={p.id}
                            href={`/projects/${p.code}`}
                            className="font-mono text-[9px] text-ink-3 hover:text-ink hover:underline"
                            title={`${p.name} · ${p.stage}`}
                          >
                            {p.code}
                          </Link>
                        ))}
                        {r.projects.length > 3 && (
                          <span className="text-[9px] text-ink-4">
                            +{r.projects.length - 3}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.lastProject ? (
                      <Link
                        href={`/projects/${r.lastProject.code}`}
                        className="hover:underline"
                        title={r.lastProject.name}
                      >
                        <span className="font-mono text-[10px] text-ink-3">
                          {r.lastProject.code}
                        </span>{' '}
                        <span className="text-[11px] text-ink">
                          {r.lastProject.name.length > 28
                            ? `${r.lastProject.name.slice(0, 28)}…`
                            : r.lastProject.name}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-[11px] text-ink-4">—</span>
                    )}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right tabular-nums ${
                      r.revenueLtmCents > 0 ? 'text-ink' : 'text-ink-4'
                    }`}
                  >
                    {formatMoney(r.revenueLtmCents)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                    {formatMoney(r.totalRevenueCents)}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.lastWorkAt ? (
                      <span
                        className={`text-[11px] tabular-nums ${
                          r.notWorkedInLtm
                            ? 'text-status-amber'
                            : 'text-ink-2'
                        }`}
                      >
                        {r.lastWorkAt.toLocaleDateString('en-AU', {
                          month: 'short',
                          year: 'numeric',
                        })}
                        {r.notWorkedInLtm && (
                          <span className="ml-1 text-[9px] uppercase">
                            dormant
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[10px] uppercase text-status-amber">
                        no activity
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
