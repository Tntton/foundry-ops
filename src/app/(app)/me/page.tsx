import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { prisma } from '@/server/db';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MyContactForm } from './contact-form';
import { SignOutButton } from './signout-button';
import {
  BankDetailsForm,
  EmergencyContactForm,
  PublicProfileForm,
  AssetUploader,
} from './profile-forms';
import { HeadshotEditButton } from '@/components/headshot-edit-button';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatHours(h: number): string {
  return `${h.toFixed(1)}h`;
}

const MS_PER_DAY = 24 * 3600 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

function startOfWeek(d: Date): Date {
  // Monday-anchored weeks (AU/NZ payroll convention).
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  const dow = x.getUTCDay(); // 0 = Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  x.setUTCDate(x.getUTCDate() + diff);
  return x;
}

/**
 * The signed-in person's own profile page. Self-readable surface that
 * complements the admin-facing /directory/people/[id] view — staff edit
 * their contact details here, see their own hours / billable revenue /
 * pay terms / project history.
 *
 * No directory-list role gate: every signed-in person can see their own
 * profile. Sensitive payroll fields (bank, super, TFN) stay locked to
 * super_admin / admin per CLAUDE.md security notes — those edits live
 * on the admin profile editor.
 */
export default async function MyProfilePage() {
  const session = await getSession();
  if (!session) notFound();

  const me = await prisma.person.findUnique({
    where: { id: session.person.id },
    select: {
      id: true,
      initials: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      whatsappNumber: true,
      mailingAddress: true,
      band: true,
      level: true,
      employment: true,
      fte: true,
      region: true,
      rateUnit: true,
      rate: true,
      billRate: true,
      roles: true,
      additionalRoles: true,
      startDate: true,
      endDate: true,
      // Bank — sensitive but self-readable. Field-level encryption is
      // architectural intent (see schema comments), not yet enforced
      // at column level.
      bankCountry: true,
      bankAccountName: true,
      bankName: true,
      bankBsb: true,
      bankAcc: true,
      bankSwift: true,
      bankIban: true,
      // Emergency contact
      emergencyContactName: true,
      emergencyContactRelationship: true,
      emergencyContactPhone: true,
      emergencyContactEmail: true,
      // Assets + bio
      cvUrl: true,
      headshotUrl: true,
      websiteBlurb: true,
    },
  });
  if (!me) notFound();

  // ── Hours rolled up by week for the last 12 weeks. Used for the
  // earnings chart + lifetime totals. Keep the queries sequential — the
  // page already runs several other prisma calls and we want to stay
  // well within the connection-pool budget.
  const twelveWeeksAgo = new Date(Date.now() - 12 * MS_PER_WEEK);
  const recentEntries = await prisma.timesheetEntry.findMany({
    where: {
      personId: me.id,
      date: { gte: twelveWeeksAgo },
    },
    orderBy: { date: 'asc' },
    select: { date: true, hours: true, status: true, projectId: true },
  });

  // Lifetime totals — done as count + aggregate so we don't pull every row.
  const lifetimeAgg = await prisma.timesheetEntry.aggregate({
    where: { personId: me.id },
    _sum: { hours: true },
  });
  const lifetimeBillableAgg = await prisma.timesheetEntry.aggregate({
    where: {
      personId: me.id,
      status: { in: ['approved', 'billed'] },
      billedInvoiceId: { not: null },
    },
    _sum: { hours: true },
  });
  const lifetimeHours = Number(lifetimeAgg._sum.hours ?? 0);
  const lifetimeBillable = Number(lifetimeBillableAgg._sum.hours ?? 0);

  // Bucket recent entries into Monday-anchored weeks for the bar chart.
  const weeks: Array<{
    weekStart: Date;
    label: string;
    hoursTotal: number;
    hoursBillable: number;
  }> = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const start = startOfWeek(new Date(now.getTime() - i * MS_PER_WEEK));
    weeks.push({
      weekStart: start,
      label: start.toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'short',
      }),
      hoursTotal: 0,
      hoursBillable: 0,
    });
  }
  for (const e of recentEntries) {
    const eStart = startOfWeek(e.date);
    const wk = weeks.find((w) => w.weekStart.getTime() === eStart.getTime());
    if (!wk) continue;
    const hours = Number(e.hours);
    wk.hoursTotal += hours;
    if (e.status === 'approved' || e.status === 'billed') {
      wk.hoursBillable += hours;
    }
  }
  const recentHoursTotal = weeks.reduce((s, w) => s + w.hoursTotal, 0);
  const recentBillable = weeks.reduce((s, w) => s + w.hoursBillable, 0);
  const maxWeekHours = Math.max(1, ...weeks.map((w) => w.hoursTotal));

  // Earnings — for the staff member, "earnings" = their hours × cost
  // rate (what Foundry pays for their time). Distinct from billable
  // revenue (× billRate) which is what the firm earned from their work.
  // Both useful — show side by side.
  const recentEarningsCents = Math.round(recentHoursTotal * me.rate);
  const recentBillableRevenueCents =
    me.billRate !== null ? Math.round(recentBillable * me.billRate) : null;
  // Lifetime earnings (hours × cost rate) computed but not surfaced —
  // we show lifetime billable revenue (hours × bill rate) on the pay
  // card instead since that's the firm-contribution number staff care
  // about. Keeping the calc commented in case we add a "compensation"
  // breakdown later.
  // const _lifetimeEarningsCents = Math.round(lifetimeHours * me.rate);
  const lifetimeBillableRevenueCents =
    me.billRate !== null ? Math.round(lifetimeBillable * me.billRate) : null;

  // ── Current and previous projects ──────────────────────────────────
  const teamMemberships = await prisma.projectTeam.findMany({
    where: { personId: me.id },
    select: {
      id: true,
      roleOnProject: true,
      allocationPct: true,
      project: {
        select: {
          id: true,
          code: true,
          name: true,
          stage: true,
          startDate: true,
          endDate: true,
          actualEndDate: true,
          client: { select: { code: true, legalName: true } },
        },
      },
    },
  });

  // Projects where I've logged time but I'm not on the formal team —
  // catches ad-hoc collaboration. Pulled separately so the "ghost" rows
  // can be highlighted.
  const projectIdsWithMyTime = await prisma.timesheetEntry.findMany({
    where: { personId: me.id },
    distinct: ['projectId'],
    select: { projectId: true },
  });
  const teamProjectIds = new Set(teamMemberships.map((t) => t.project.id));
  const ghostProjectIds = projectIdsWithMyTime
    .map((r) => r.projectId)
    .filter((id) => id && !teamProjectIds.has(id)) as string[];
  const ghostProjects =
    ghostProjectIds.length > 0
      ? await prisma.project.findMany({
          where: { id: { in: ghostProjectIds } },
          select: {
            id: true,
            code: true,
            name: true,
            stage: true,
            startDate: true,
            endDate: true,
            actualEndDate: true,
            client: { select: { code: true, legalName: true } },
          },
        })
      : [];

  type ProjectRow = {
    id: string;
    code: string;
    name: string;
    stage: string;
    startDate: Date | null;
    endDate: Date | null;
    actualEndDate: Date | null;
    client: { code: string; legalName: string };
    role: string | null;
    allocationPct: number | null;
    onTeam: boolean;
  };
  const allProjects: ProjectRow[] = [
    ...teamMemberships.map<ProjectRow>((t) => ({
      ...t.project,
      role: t.roleOnProject,
      allocationPct: t.allocationPct,
      onTeam: true,
    })),
    ...ghostProjects.map<ProjectRow>((p) => ({
      ...p,
      role: null,
      allocationPct: null,
      onTeam: false,
    })),
  ];
  const currentProjects = allProjects.filter(
    (p) =>
      p.stage === 'kickoff' || p.stage === 'delivery' || p.stage === 'closing',
  );
  const previousProjects = allProjects.filter((p) => p.stage === 'archived');

  // FTE display — 0.6 → "0.6 FTE" / null → "—"
  const fteLabel = me.fte !== null ? `${Number(me.fte).toFixed(1)} FTE` : '—';
  const tenureMonths = (() => {
    const end = me.endDate ?? new Date();
    return Math.max(
      0,
      Math.round((end.getTime() - me.startDate.getTime()) / (30 * MS_PER_DAY)),
    );
  })();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {/* Use the uploaded headshot when we have one — fall back to
              the initials avatar otherwise so the header stays stable
              before the image lands. */}
          {me.headshotUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={me.headshotUrl}
              alt={`${me.firstName} ${me.lastName}`}
              className="h-12 w-12 rounded-full border border-line object-cover"
            />
          ) : (
            <PersonAvatar
  className="h-12 w-12"
  fallbackClassName="text-sm"
  initials={me.initials}
  headshotUrl={me.headshotUrl}
/>
          )}
          <div>
            <h1 className="text-xl font-semibold text-ink">
              {me.firstName} {me.lastName}
            </h1>
            <p className="text-sm text-ink-3">
              <Badge variant="outline" className="mr-2 text-[10px]">
                {me.band}
              </Badge>
              <span className="font-mono text-xs">{me.level}</span>
              <span className="ml-2">· {me.employment.replace('_', ' ')}</span>
              <span className="ml-2 text-ink-4">· {fteLabel}</span>
            </p>
            {me.additionalRoles.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {me.additionalRoles.map((r) => (
                  <Badge
                    key={r}
                    variant="blue"
                    className="text-[10px]"
                  >
                    {r}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          {me.roles.map((r) => (
            <Badge key={r} variant="outline" className="text-[10px] capitalize">
              {r.replace('_', ' ')}
            </Badge>
          ))}
        </div>
      </header>

      {/* ── Headline KPIs ───────────────────────────────────────────── */}
      {/* Hidden for Support_Staff — these metrics (hours, earnings, billable
          revenue, lifetime hours) all assume billable consulting work and
          surface as zeros/N/A for non-delivery bands. Tenure stays visible
          on the bottom card. */}
      {me.band !== 'Support_Staff' && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <KpiCard
            label="Hours · 12 wks"
            value={formatHours(recentHoursTotal)}
            sub={`${formatHours(recentBillable)} billable`}
          />
          <KpiCard
            label="Earnings · 12 wks"
            value={formatMoney(recentEarningsCents)}
            sub={`${me.rate ? formatMoney(me.rate) + '/' + me.rateUnit : '—'} cost rate`}
          />
          <KpiCard
            label="Billable revenue · 12 wks"
            value={
              recentBillableRevenueCents !== null
                ? formatMoney(recentBillableRevenueCents)
                : '—'
            }
            sub={
              me.billRate !== null
                ? `${formatMoney(me.billRate)}/h to clients`
                : 'no bill rate set'
            }
          />
          <KpiCard
            label="Lifetime hours"
            value={formatHours(lifetimeHours)}
            sub={`${formatHours(lifetimeBillable)} billed`}
          />
          <KpiCard
            label="Tenure"
            value={`${Math.floor(tenureMonths / 12)}y ${tenureMonths % 12}m`}
            sub={`since ${me.startDate.toLocaleDateString('en-AU')}`}
          />
        </div>
      )}

      {/* ── Hours visualisation ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Hours by week</CardTitle>
          <CardDescription>
            Last 12 weeks · billable hours in solid, total hours in faded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentHoursTotal === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">
              No hours logged in the last 12 weeks.{' '}
              <Link href="/timesheet" className="text-brand hover:underline">
                Open timesheet →
              </Link>
            </p>
          ) : (
            <div className="space-y-1">
              {weeks.map((w) => {
                const billableWidth =
                  (w.hoursBillable / maxWeekHours) * 100;
                const totalWidth = (w.hoursTotal / maxWeekHours) * 100;
                const nonBillableWidth = totalWidth - billableWidth;
                return (
                  <div
                    key={w.weekStart.toISOString()}
                    className="grid grid-cols-[80px_1fr_60px] items-center gap-3"
                  >
                    <span className="font-mono text-[10px] text-ink-3">
                      {w.label}
                    </span>
                    <div className="flex h-3 w-full overflow-hidden rounded bg-surface-subtle">
                      <div
                        className="h-full bg-status-green"
                        style={{ width: `${billableWidth}%` }}
                        title={`${formatHours(w.hoursBillable)} billable`}
                      />
                      {nonBillableWidth > 0 && (
                        <div
                          className="h-full bg-status-green-soft"
                          style={{ width: `${nonBillableWidth}%` }}
                          title={`${formatHours(w.hoursTotal - w.hoursBillable)} non-billable`}
                        />
                      )}
                    </div>
                    <span className="text-right tabular-nums text-xs text-ink-2">
                      {formatHours(w.hoursTotal)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* ── Personal details (editable) ────────────────────────────── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
            <CardDescription>
              Update your contact info anytime. Phone &amp; WhatsApp drive
              after-hours approvals; mailing address is used for kit
              dispatch and statements.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1 text-sm">
              <Row label="Email">
                <span className="font-mono text-xs">{me.email}</span>
                <span className="ml-2 text-[10px] text-ink-4">
                  (locked · auth identity)
                </span>
              </Row>
              <Row label="Region">
                <span className="font-mono">{me.region}</span>
              </Row>
              <Row label="Started">
                {me.startDate.toLocaleDateString('en-AU', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </Row>
              {me.endDate && (
                <Row label="Ends">
                  {me.endDate.toLocaleDateString('en-AU')}
                </Row>
              )}
            </div>

            <div className="border-t border-line pt-4">
              <MyContactForm
                defaultPhone={me.phone}
                defaultWhatsApp={me.whatsappNumber}
                defaultMailingAddress={me.mailingAddress}
              />
            </div>
          </CardContent>
        </Card>

        {/* ── Pay agreement ─────────────────────────────────────────── */}
        {/* Support_Staff sees a slimmed version — just band/level/employment/FTE,
            without the cost/bill rates + margin + lifetime billable revenue,
            none of which apply to off-the-pyramid roles. */}
        <Card>
          <CardHeader>
            <CardTitle>Pay agreement</CardTitle>
            <CardDescription>
              Commensurate with your level. HR-controlled — request changes
              via the Managing Partner.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Band">
              <Badge variant="outline">{me.band}</Badge>
            </Row>
            <Row label="Level">
              <span className="font-mono text-xs">{me.level}</span>
            </Row>
            <Row label="Employment">
              <span className="capitalize">
                {me.employment.replace('_', ' ')}
              </span>
            </Row>
            <Row label="FTE">{fteLabel}</Row>
            {me.band !== 'Support_Staff' && (
              <>
                <div className="border-t border-line pt-2">
                  <Row label="Cost rate">
                    <span className="font-semibold tabular-nums text-ink">
                      {formatMoney(me.rate)}
                      <span className="text-xs text-ink-3">/{me.rateUnit}</span>
                    </span>
                  </Row>
                  <Row label="Bill rate">
                    {me.billRate !== null ? (
                      <span className="font-semibold tabular-nums text-ink">
                        {formatMoney(me.billRate)}
                        <span className="text-xs text-ink-3">/{me.rateUnit}</span>
                      </span>
                    ) : (
                      <span className="text-ink-3">— not billable</span>
                    )}
                  </Row>
                  {me.billRate !== null && me.rate > 0 && (
                    <Row label="Margin per hour">
                      <span className="tabular-nums text-ink-2">
                        {formatMoney(me.billRate - me.rate)}{' '}
                        <span className="text-[10px] text-ink-3">
                          ({Math.round(((me.billRate - me.rate) / me.billRate) * 100)}
                          %)
                        </span>
                      </span>
                    </Row>
                  )}
                </div>
                <p className="border-t border-line pt-2 text-[10px] text-ink-3">
                  Lifetime billable revenue contributed:{' '}
                  <strong className="text-ink-2">
                    {lifetimeBillableRevenueCents !== null
                      ? formatMoney(lifetimeBillableRevenueCents)
                      : '—'}
                  </strong>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Public profile (assets + blurb + additional roles) ─────── */}
      <Card>
        <CardHeader>
          <CardTitle>Public profile</CardTitle>
          <CardDescription>
            Assets and bio used on the firm&apos;s website &amp; intro decks.
            Additional roles capture hats you wear beyond your band/level.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-6">
            <div className="space-y-1">
              <div className="text-xs font-medium text-ink-3">Headshot</div>
              <HeadshotEditButton currentUrl={me.headshotUrl} />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-ink-3">CV</div>
              <AssetUploader kind="cv" currentUrl={me.cvUrl} />
            </div>
          </div>
          <div className="border-t border-line pt-4">
            <PublicProfileForm
              defaults={{
                websiteBlurb: me.websiteBlurb,
                additionalRoles: me.additionalRoles,
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Bank account ───────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Bank account</CardTitle>
          <CardDescription>
            For payroll and reimbursements. AU defaults to BSB + Acc;
            switching country swaps to SWIFT/BIC + IBAN. Self-readable;
            visible to admins only otherwise.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BankDetailsForm
            defaults={{
              bankCountry: me.bankCountry,
              bankAccountName: me.bankAccountName,
              bankName: me.bankName,
              bankBsb: me.bankBsb,
              bankAcc: me.bankAcc,
              bankSwift: me.bankSwift,
              bankIban: me.bankIban,
            }}
          />
        </CardContent>
      </Card>

      {/* ── Emergency contact ──────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Emergency contact</CardTitle>
          <CardDescription>
            Who to call after-hours if something happens. Visible to
            admins for HR / safety only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmergencyContactForm
            defaults={{
              emergencyContactName: me.emergencyContactName,
              emergencyContactRelationship: me.emergencyContactRelationship,
              emergencyContactPhone: me.emergencyContactPhone,
              emergencyContactEmail: me.emergencyContactEmail,
            }}
          />
        </CardContent>
      </Card>

      {/* ── Projects (current + previous) ───────────────────────────── */}
      <Card className="p-0">
        <CardHeader>
          <CardTitle>Current projects ({currentProjects.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {currentProjects.length === 0 ? (
            <p className="py-2 text-sm text-ink-3">
              Not on any active projects.
            </p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {currentProjects.map((p) => (
                <ProjectListItem key={p.id} project={p} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {previousProjects.length > 0 && (
        <Card className="p-0">
          <CardHeader>
            <CardTitle>Previous projects ({previousProjects.length})</CardTitle>
            <CardDescription>Archived engagements you contributed to.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-line text-sm">
              {previousProjects.map((p) => (
                <ProjectListItem key={p.id} project={p} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Session</CardTitle>
          <CardDescription>
            Signed in as{' '}
            <span className="font-mono text-xs text-ink-2">{me.email}</span>.
            Sign out to end this session on this device.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2 py-0.5">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}

const STAGE_VARIANT: Record<string, 'amber' | 'green' | 'blue' | 'outline'> = {
  kickoff: 'amber',
  delivery: 'green',
  closing: 'blue',
  archived: 'outline',
};

function ProjectListItem({
  project,
}: {
  project: {
    id: string;
    code: string;
    name: string;
    stage: string;
    startDate: Date | null;
    endDate: Date | null;
    actualEndDate: Date | null;
    client: { code: string; legalName: string };
    role: string | null;
    allocationPct: number | null;
    onTeam: boolean;
  };
}) {
  const end = project.actualEndDate ?? project.endDate;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/projects/${project.code}`}
            className="font-mono text-xs text-ink hover:underline"
          >
            {project.code}
          </Link>
          <span className="text-ink">{project.name}</span>
          <Badge
            variant={STAGE_VARIANT[project.stage] ?? 'outline'}
            className="capitalize text-[10px]"
          >
            {project.stage}
          </Badge>
          {!project.onTeam && (
            <Badge variant="amber" className="text-[10px]">
              Logged hours · not on roster
            </Badge>
          )}
        </div>
        <div className="mt-0.5 text-xs text-ink-3">
          {project.client.code} · {project.client.legalName}
          {project.role && (
            <span className="ml-1 text-ink-2">· {project.role}</span>
          )}
          {project.allocationPct !== null && (
            <span className="ml-1 text-ink-3">
              · {project.allocationPct}% allocation
            </span>
          )}
        </div>
      </div>
      <div className="text-right text-xs tabular-nums text-ink-3">
        {project.startDate
          ? project.startDate.toLocaleDateString('en-AU')
          : '—'}{' '}
        →{' '}
        {end ? end.toLocaleDateString('en-AU') : 'open'}
      </div>
    </li>
  );
}
