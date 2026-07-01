import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/** AUD cents → "$1,234" (no cents; matches the tracker sheet's display). */
function formatMoney(cents: number): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? '-' : '';
  return `${sign}$${abs.toLocaleString('en-AU', { maximumFractionDigits: 2 })}`;
}

/**
 * Per-project financial tracker — mirrors the layout of the master
 * tracker's per-project sheets (e.g. "MQH001 Growth Strategy Financial
 * Tracker"). Super-admin + admin only.
 *
 * Structure:
 *   1. Header — chargecode, authority, date commenced, weeks
 *   2. Project Financial Overview — fee, OPEX contribution, margin
 *      pool, referral, project expenses, LT pool residual, margin %
 *   3. LT Pool distribution — partner splits (from
 *      ProjectPartnerContribution rows)
 *   4. Rate Card / Consultant Costs — actuals from ContractorInvoice
 *      + TimesheetEntry × Person.rate, grouped by person
 *   5. Itemised Expenses — actuals from project-tagged Bill + Expense
 *
 * All contribution percentages come from ProjectBudget when set; fall
 * back to firm defaults (20% OPEX / 15% margin pool / 0% referral) so
 * the tracker renders even for projects without a budget row yet.
 */
const DEFAULT_OPEX_PCT = 20;
const DEFAULT_MARGIN_POOL_PCT = 15;
const DEFAULT_REFERRAL_PCT = 0;

export default async function ProjectTrackerPage({
  params,
}: {
  params: { code: string };
}) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin'])) notFound();

  const project = await prisma.project.findUnique({
    where: { code: params.code.toUpperCase() },
    include: {
      client: { select: { code: true, legalName: true } },
      primaryPartner: { select: { firstName: true, lastName: true, initials: true } },
      manager: { select: { firstName: true, lastName: true, initials: true } },
    },
  });
  if (!project) notFound();

  const [budget, partnerContributions, contractorInvoices, timesheets, bills, expenses] =
    await Promise.all([
      prisma.projectBudget.findUnique({ where: { projectId: project.id } }),
      prisma.projectPartnerContribution.findMany({
        where: { projectId: project.id },
        include: {
          person: { select: { firstName: true, lastName: true, initials: true } },
        },
      }),
      prisma.contractorInvoice.findMany({
        where: { projectId: project.id },
        include: { person: { select: { firstName: true, lastName: true } } },
        orderBy: { periodAnchor: 'asc' },
      }),
      prisma.timesheetEntry.findMany({
        where: { projectId: project.id, status: { in: ['approved', 'billed'] } },
        include: { person: { select: { firstName: true, lastName: true, rate: true } } },
      }),
      prisma.bill.findMany({
        where: {
          projectId: project.id,
          status: { in: ['approved', 'scheduled_for_payment', 'paid'] },
        },
        orderBy: { issueDate: 'asc' },
      }),
      prisma.expense.findMany({
        where: {
          projectId: project.id,
          status: { in: ['approved', 'reimbursed', 'batched_for_payment'] },
        },
        include: { person: { select: { firstName: true, lastName: true } } },
        orderBy: { date: 'asc' },
      }),
    ]);

  // ── Financial overview % — from budget or defaults ─────────────────
  const opexPct = budget?.opexContributionPct ?? DEFAULT_OPEX_PCT;
  const marginPoolPct = budget?.firmProfitPoolPct ?? DEFAULT_MARGIN_POOL_PCT;
  const referralPct = budget?.bdReferralPct ?? DEFAULT_REFERRAL_PCT;
  const feeCents = project.contractValue;
  const opexContribCents = Math.round((feeCents * opexPct) / 100);
  const marginPoolContribCents = Math.round((feeCents * marginPoolPct) / 100);
  const referralCents = Math.min(
    Math.round((feeCents * referralPct) / 100),
    budget?.bdReferralCapCents ?? Infinity,
  );

  // ── Consultant Costs — aggregate ContractorInvoice + Timesheet ────
  type CostRow = {
    name: string;
    hours: number;
    amountCents: number;
    source: string; // "Contractor invoice" | "Timesheet @ $X/hr"
  };
  const costsByPerson = new Map<string, CostRow>();
  for (const ci of contractorInvoices) {
    const name = `${ci.person.firstName} ${ci.person.lastName}`;
    const key = `${name}|${ci.roleOnInvoice ?? ''}`;
    const existing = costsByPerson.get(key);
    if (existing) {
      existing.hours += Number(ci.hours);
      existing.amountCents += ci.amountExGst;
    } else {
      costsByPerson.set(key, {
        name,
        hours: Number(ci.hours),
        amountCents: ci.amountExGst,
        source: ci.roleOnInvoice ?? 'Contractor invoice',
      });
    }
  }
  for (const t of timesheets) {
    const rateCents = t.person.rate ?? 0;
    const hours = Number(t.hours);
    const cost = Math.round(hours * rateCents);
    const name = `${t.person.firstName} ${t.person.lastName}`;
    const key = `${name}|ts@${rateCents}`;
    const existing = costsByPerson.get(key);
    if (existing) {
      existing.hours += hours;
      existing.amountCents += cost;
    } else {
      costsByPerson.set(key, {
        name,
        hours,
        amountCents: cost,
        source: `Timesheet @ $${(rateCents / 100).toFixed(0)}/hr`,
      });
    }
  }
  const consultantRows = Array.from(costsByPerson.values()).sort(
    (a, b) => b.amountCents - a.amountCents,
  );
  const consultantTotalCents = consultantRows.reduce((s, r) => s + r.amountCents, 0);
  const consultantTotalHours = consultantRows.reduce((s, r) => s + r.hours, 0);

  // ── Itemised Expenses — Bills + Expenses (ex-GST) ─────────────────
  type ExpenseRow = {
    label: string;
    amountCents: number; // ex GST
    date: Date | null;
    comment: string | null;
  };
  const expenseRows: ExpenseRow[] = [
    ...bills.map((b) => ({
      label: b.supplierName ?? 'Bill',
      amountCents: b.amountTotal - b.gst,
      date: b.issueDate,
      comment: b.category,
    })),
    ...expenses.map((e) => ({
      label: `${e.vendor ?? 'Expense'} · ${e.person.firstName} ${e.person.lastName}`,
      amountCents: e.amount - e.gst,
      date: e.date,
      comment: e.category,
    })),
  ].sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  const expenseTotalCents = expenseRows.reduce((s, r) => s + r.amountCents, 0);

  // ── LT Pool residual = Fee − OPEX − Margin Pool − Referral − Expenses
  const ltPoolResidualCents =
    feeCents -
    opexContribCents -
    marginPoolContribCents -
    referralCents -
    expenseTotalCents;
  const profitMarginPct = feeCents > 0
    ? Math.round((ltPoolResidualCents / feeCents) * 100)
    : 0;

  // ── LT Pool distribution — from ProjectPartnerContribution ─────────
  // The master tracker allocates the LT pool by partner. We sum the
  // `contributionPct` for each partner across roles they hold, then
  // renormalise to 100% so the pool splits without a leftover.
  const partnerTotals = new Map<string, {
    initials: string; name: string; pct: number; roles: string[];
  }>();
  for (const c of partnerContributions) {
    const key = c.personId;
    const existing = partnerTotals.get(key);
    if (existing) {
      existing.pct += c.contributionPct;
      existing.roles.push(c.role);
    } else {
      partnerTotals.set(key, {
        initials: c.person.initials,
        name: `${c.person.firstName} ${c.person.lastName}`,
        pct: c.contributionPct,
        roles: [c.role],
      });
    }
  }
  const partnerPctTotal = Array.from(partnerTotals.values()).reduce((s, p) => s + p.pct, 0);
  const ltDistribution = Array.from(partnerTotals.values()).map((p) => {
    const sharePct = partnerPctTotal > 0 ? (p.pct / partnerPctTotal) * 100 : 0;
    return {
      ...p,
      sharePct: Math.round(sharePct * 100) / 100,
      earningsCents: Math.round((ltPoolResidualCents * sharePct) / 100),
    };
  });

  // ── Meta row for header ────────────────────────────────────────────
  const weeksBetween = (a: Date | null, b: Date | null): number | null => {
    if (!a || !b) return null;
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / (7 * 86_400_000)));
  };
  const numberOfWeeks = budget?.numberOfWeeks
    ?? weeksBetween(project.startDate, project.endDate)
    ?? null;
  const dateCommenced = project.startDate
    ? project.startDate.toISOString().slice(0, 10)
    : '—';
  const authority = [project.primaryPartner.initials, project.manager.initials]
    .filter(Boolean)
    .join(' / ');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            {project.code} · {project.name}
          </h1>
          <p className="text-sm text-ink-3">
            {project.client.legalName} · Financial Tracker (admin view)
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Link
            href={`/projects/${project.code}`}
            className="rounded-md border border-line px-2 py-1 text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            ← Overview
          </Link>
          <Link
            href={`/projects/${project.code}/budget`}
            className="rounded-md border border-line px-2 py-1 text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            Budget
          </Link>
          {!budget && (
            <Badge variant="amber" className="text-[10px]">
              No budget saved — using firm defaults
            </Badge>
          )}
        </div>
      </header>

      {/* ── Header meta row ──────────────────────────────────────────── */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 py-3 text-sm md:grid-cols-4">
          <MetaCell label="Chargecode" value={project.code} />
          <MetaCell label="Authority" value={authority || '—'} />
          <MetaCell label="Date commenced" value={dateCommenced} />
          <MetaCell
            label="Number of weeks"
            value={numberOfWeeks !== null ? `${numberOfWeeks}` : '—'}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ── Project Financial Overview ──────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Project Financial Overview</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-left">Line</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-right">%</th>
                  <th className="px-3 py-2 text-left">Comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <FinRow
                  label="Project Fee (ex-GST)"
                  value={feeCents}
                  pct={100}
                />
                <FinRow
                  label="FH OPEX Contribution"
                  value={-opexContribCents}
                  pct={-opexPct}
                  comment="Fixed % per FY26 governance"
                />
                <FinRow
                  label="FH Margin Pool Contribution"
                  value={-marginPoolContribCents}
                  pct={-marginPoolPct}
                  comment="Fixed % per FY26 governance"
                />
                <FinRow
                  label="Referral Fee"
                  value={-referralCents}
                  pct={-referralPct}
                  comment={referralCents > 0 ? 'Capped per budget' : 'No referral'}
                />
                <FinRow
                  label="Project Expenses"
                  value={-expenseTotalCents}
                  pct={feeCents > 0 ? -(expenseTotalCents / feeCents) * 100 : 0}
                  comment={`${expenseRows.length} itemised · from actuals`}
                />
                <FinRow
                  label="FH LT Pool residual"
                  value={ltPoolResidualCents}
                  pct={feeCents > 0 ? (ltPoolResidualCents / feeCents) * 100 : 0}
                  comment="Fee minus OPEX, margin pool, referral, expenses"
                  emphasis
                />
                <tr>
                  <td className="px-3 py-2 text-sm font-medium italic text-ink-2">
                    Profit (non-operating) margin
                  </td>
                  <td colSpan={2} className="px-3 py-2 text-right text-sm font-semibold italic text-ink">
                    {profitMarginPct}%
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-3">
                    LT residual as % of fee
                  </td>
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* ── LT Pool distribution ────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">LT Pool distribution</CardTitle>
            <p className="text-xs text-ink-3">
              Total to distribute:{' '}
              <span className="font-mono">{formatMoney(ltPoolResidualCents)}</span>
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {ltDistribution.length === 0 ? (
              <div className="p-4 text-xs text-ink-3">
                No partner contributions recorded.{' '}
                <Link
                  href={`/projects/${project.code}/contributions`}
                  className="text-brand hover:underline"
                >
                  Add partners →
                </Link>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-3">
                  <tr className="border-b border-line">
                    <th className="px-3 py-2 text-left">Partner</th>
                    <th className="px-3 py-2 text-right">Share %</th>
                    <th className="px-3 py-2 text-right">Earnings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {ltDistribution.map((p) => (
                    <tr key={p.initials}>
                      <td className="px-3 py-2">
                        <div className="font-mono text-[11px] text-ink-3">{p.initials}</div>
                        <div className="text-sm text-ink">{p.name}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-sm">
                        {p.sharePct.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-sm text-ink">
                        {formatMoney(p.earningsCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Rate Card / Consultant Costs ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Rate Card · Consultant Costs (AUD)
          </CardTitle>
          <p className="text-xs text-ink-3">
            Actuals from contractor invoices + timesheet hours × current cost rate.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {consultantRows.length === 0 ? (
            <div className="p-4 text-xs text-ink-3">
              No consultant costs recorded on this project yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-left">Consultant</th>
                  <th className="px-3 py-2 text-right">Hours</th>
                  <th className="px-3 py-2 text-right">Actual amount (ex-GST)</th>
                  <th className="px-3 py-2 text-left">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {consultantRows.map((r, i) => (
                  <tr key={`${r.name}-${i}`}>
                    <td className="px-3 py-2 text-ink">{r.name}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {r.hours.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatMoney(r.amountCents)}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-3">{r.source}</td>
                  </tr>
                ))}
                <tr className="bg-surface-subtle/50 font-medium">
                  <td className="px-3 py-2">Rolling total</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {consultantTotalHours.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatMoney(consultantTotalCents)}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ── Itemised Expenses ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Itemised Expenses (AUD)</CardTitle>
          <p className="text-xs text-ink-3">
            Project-tagged bills + reimbursable expenses. Amounts shown ex-GST.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {expenseRows.length === 0 ? (
            <div className="p-4 text-xs text-ink-3">
              No project-tagged expenses recorded.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-3">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-right">Actual amount (ex-GST)</th>
                  <th className="px-3 py-2 text-left">Comment</th>
                  <th className="px-3 py-2 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {expenseRows.map((r, i) => (
                  <tr key={`${r.label}-${i}`}>
                    <td className="px-3 py-2 text-ink">{r.label}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatMoney(r.amountCents)}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-3">{r.comment ?? ''}</td>
                    <td className="px-3 py-2 text-right text-xs text-ink-3 tabular-nums">
                      {r.date ? r.date.toISOString().slice(0, 10) : ''}
                    </td>
                  </tr>
                ))}
                <tr className="bg-surface-subtle/50 font-medium">
                  <td className="px-3 py-2">Total (to date)</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatMoney(expenseTotalCents)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-0.5 font-medium text-ink">{value}</div>
    </div>
  );
}

function FinRow({
  label,
  value,
  pct,
  comment,
  emphasis,
}: {
  label: string;
  value: number;
  pct: number;
  comment?: string;
  emphasis?: boolean;
}) {
  return (
    <tr className={emphasis ? 'bg-surface-subtle/50' : undefined}>
      <td className={`px-3 py-2 text-ink ${emphasis ? 'font-medium' : ''}`}>{label}</td>
      <td className={`px-3 py-2 text-right font-mono tabular-nums ${emphasis ? 'font-semibold' : ''}`}>
        {formatMoney(value)}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-3">
        {Math.round(pct)}%
      </td>
      <td className="px-3 py-2 text-xs text-ink-3">{comment ?? ''}</td>
    </tr>
  );
}
