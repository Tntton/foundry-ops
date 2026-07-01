import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { prisma } from '@/server/db';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProvisionSharePointButton } from './provision-button';
import { computeProjectPnL, type ProjectPnL } from '@/server/projects/pnl';
import { computeProjectTeamUtilisation } from '@/server/projects/team-utilisation';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { ArchiveProjectButton, ReactivateProjectButton } from './archive/dialog';
import { ProjectChecklistsPanel } from './checklists/panel';
import { ProjectHoursPanel } from './hours/panel';
import { listProjectTimesheetEntries } from '@/server/timesheet';
import { computeProjectOverviewExtras } from '@/server/projects/overview';
import { TeamQuickAdd, RemoveTeamMemberButton } from './team/quick-add';
import { ProjectTeamSection } from './team/team-section';
import { ProjectBudgetSection } from './budget/budget-section';
import { ProjectContributionsEditor } from './contributions/contributions-editor';
import { computeProjectBudget } from '@/server/projects/budget';
import { WaterfallChart, type WaterfallStep } from '@/components/charts/waterfall';
import { listActivePeopleOptions } from '@/server/projects';
import { isInternalProject, shouldShowPnL } from '@/lib/project-kind';

const STAGE_VARIANT: Record<string, 'amber' | 'green' | 'blue' | 'outline'> = {
  kickoff: 'amber',
  delivery: 'green',
  closing: 'blue',
  archived: 'outline',
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

// Tabs we accept via `?tab=` deep-link. Anything not in this list
// falls back to the default ("overview") so a bad URL can't render
// a non-existent tab.
const KNOWN_TABS = [
  'overview',
  'milestones',
  'files',
  'risks',
  'checklists',
  'team',
  'hours',
  'pnl',
  'budget',
  'invoices',
  'expenses',
] as const;
type ProjectTab = (typeof KNOWN_TABS)[number];

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams: { tab?: string };
}) {
  const session = await getSession();
  if (!session) notFound();
  // Coerce the requested tab to a known value or fall back to
  // "overview". This is what `new-project` → "Initialise budget"
  // uses to land the partner straight on the Budget tab.
  const initialTab: ProjectTab =
    searchParams.tab && (KNOWN_TABS as readonly string[]).includes(searchParams.tab)
      ? (searchParams.tab as ProjectTab)
      : 'overview';

  const project = await prisma.project.findUnique({
    where: { code: params.code },
    include: {
      client: { select: { id: true, code: true, legalName: true } },
      primaryPartner: { select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true } },
      manager: { select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true } },
      team: {
        include: {
          person: {
            select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true, band: true },
          },
        },
      },
      milestones: { orderBy: { dueDate: 'asc' } },
      checklists: {
        orderBy: { order: 'asc' },
        include: { items: { orderBy: { order: 'asc' } } },
      },
    },
  });

  if (!project) notFound();

  // Role-scope check: staff can only see projects they're on; manager only their own.
  const roles = session.person.roles;
  const canSeeAll = roles.some((r) => ['super_admin', 'admin', 'partner'].includes(r));
  if (!canSeeAll) {
    const onTeam = project.team.some((t) => t.personId === session.person.id);
    const isManager = project.managerId === session.person.id;
    if (!onTeam && !isManager) notFound();
  }

  // Internal FH projects (FHP series) have no client revenue, so the
  // P&L surface is meaningless — they're tracked against an internal
  // budget only. Skip the P&L computation entirely (saves a heavy
  // roll-up too) and hide the tab below. Team utilisation + budget
  // still apply.
  const projectIsInternal = isInternalProject(project.code);
  const projectShowsPnL = shouldShowPnL(project.code);
  // (theoretical-date reminder banner removed 2026-07-02;
  // projectHasFixedWindow variable no longer needed)
  // Staff (no leader role) see Project Ops only — Overview / Milestones
  // / Files / Risks / Checklists / Team / Hours. The entire Commercials
  // tab row (P&L / Budget / Invoices / Expenses) is hidden, and the
  // overview KPI strip drops its margin/AR/expense tiles. Approvals,
  // invoices, expenses *related to themselves* still surface on the
  // dashboard / personal views — this gate is project-scoped only.
  const canSeeCommercials =
    hasAnyRole(session, ['super_admin', 'admin', 'partner']) ||
    project.managerId === session.person.id;
  const canSeePnL = projectShowsPnL && canSeeCommercials;
  const canSeeBudget = canSeeCommercials;
  // Sequentialize the heavy roll-ups — each fans out 5+ internal queries
  // and racing them in Promise.all blew Supabase's 15-connection pool. Page
  // is still fast (~150ms each) because the per-query SELECTs are tiny.
  const pnl = canSeePnL ? await computeProjectPnL(project.id) : null;
  const teamUtil = canSeeBudget
    ? await computeProjectTeamUtilisation(project.id)
    : null;
  const budget = canSeeBudget ? await computeProjectBudget(project.id) : null;

  // Partner contribution editor data — fetched here so the Team tab can
  // pre-populate. List of every partner (full + AP) for the picker; the
  // project's existing contribution rows for initial state.
  const [partnerOptions, contributionRows] = await Promise.all([
    prisma.person.findMany({
      where: { roles: { has: 'partner' }, endDate: null },
      orderBy: [{ isFullPartner: 'desc' }, { lastName: 'asc' }],
      select: {
        id: true,
        initials: true,
        firstName: true,
        lastName: true,
        isFullPartner: true,
        headshotUrl: true,
      },
    }),
    prisma.projectPartnerContribution.findMany({
      where: { projectId: project.id },
      orderBy: [{ role: 'asc' }, { contributionPct: 'desc' }],
      select: {
        personId: true,
        role: true,
        contributionPct: true,
        notes: true,
      },
    }),
  ]);

  const canEditProject =
    hasAnyRole(session, ['super_admin', 'admin']) ||
    project.primaryPartnerId === session.person.id ||
    project.managerId === session.person.id;

  const canDeleteProject = hasCapability(session, 'project.delete');

  const projectTimesheetEntries = await listProjectTimesheetEntries(project.id);
  const overviewExtras = await computeProjectOverviewExtras(project.id);
  const teamMemberIds = new Set(project.team.map((t) => t.personId));
  const peopleOptionsRaw = canEditProject ? await listActivePeopleOptions() : [];
  const teamAddOptions = peopleOptionsRaw.filter(
    (p) => !teamMemberIds.has(p.id) && p.id !== project.primaryPartnerId && p.id !== project.managerId,
  );
  const [projectInvoices, projectExpenses] = await Promise.all([
    prisma.invoice.findMany({
      where: { projectId: project.id },
      orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        number: true,
        status: true,
        issueDate: true,
        dueDate: true,
        amountExGst: true,
        gst: true,
        amountTotal: true,
        paidAt: true,
      },
    }),
    prisma.expense.findMany({
      where: { projectId: project.id },
      orderBy: [{ date: 'desc' }],
      select: {
        id: true,
        date: true,
        amount: true,
        gst: true,
        category: true,
        description: true,
        status: true,
        // Rebill state: drives the "FH absorbs" vs "→ client" chip
        // in the expenses tab and the ✓ Billed on INV-X marker when
        // a cost has already been forwarded onto a client invoice.
        rebillable: true,
        rebilledOnInvoiceId: true,
        person: { select: { initials: true, headshotUrl: true, firstName: true, lastName: true } },
      },
    }),
  ]);
  // Bills + bill-people are loaded sequentially after the AR/expense pair
  // — keeps total in-flight prisma connections well under the 15-client
  // pooler ceiling on Supabase.
  const projectBills = await prisma.bill.findMany({
    where: { projectId: project.id },
    orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      supplierPersonId: true,
      supplierName: true,
      supplierInvoiceNumber: true,
      issueDate: true,
      dueDate: true,
      amountTotal: true,
      gst: true,
      category: true,
      status: true,
      receivedVia: true,
      attachmentSharepointUrl: true,
      // Rebill state — same purpose as the Expense select above.
      rebillable: true,
      rebilledOnInvoiceId: true,
      createdAt: true,
    },
  });

  // Resolve supplier-person names for any contractor bills (no FK relation
  // on Bill.supplierPersonId, so a separate lookup keeps the listing readable).
  const billPersonIds = Array.from(
    new Set(projectBills.map((b) => b.supplierPersonId).filter((id): id is string => !!id)),
  );
  const billPeople = billPersonIds.length
    ? await prisma.person.findMany({
        where: { id: { in: billPersonIds } },
        select: { id: true, firstName: true, lastName: true, initials: true },
      })
    : [];
  const billPersonById = new Map(billPeople.map((p) => [p.id, p]));

  // Look up who uploaded each project bill (for the consolidated cost
  // table's "Submitted by" column). Bills don't carry a `submittedById`
  // column, so we read the creation audit row — one batched query for all
  // bills on this project, then mapped to a Person record.
  const billCreatorByBillId = new Map<
    string,
    { id: string; firstName: string; lastName: string; initials: string }
  >();
  if (projectBills.length > 0) {
    const creationEvents = await prisma.auditEvent.findMany({
      where: {
        entityType: 'bill',
        entityId: { in: projectBills.map((b) => b.id) },
        action: 'created',
      },
      orderBy: { at: 'asc' }, // earliest = creation
      select: {
        entityId: true,
        actor: {
          select: { id: true, firstName: true, lastName: true, initials: true },
        },
      },
    });
    for (const ev of creationEvents) {
      if (ev.actor && !billCreatorByBillId.has(ev.entityId)) {
        billCreatorByBillId.set(ev.entityId, ev.actor);
      }
    }
  }

  const [invoiceCount, billCount, expenseCount, timesheetCount, dealCount] =
    canDeleteProject
      ? await Promise.all([
          prisma.invoice.count({ where: { projectId: project.id } }),
          prisma.bill.count({ where: { projectId: project.id } }),
          prisma.expense.count({ where: { projectId: project.id } }),
          prisma.timesheetEntry.count({ where: { projectId: project.id } }),
          prisma.deal.count({ where: { convertedProjectId: project.id } }),
        ])
      : [0, 0, 0, 0, 0];
  const deleteBlockers: string[] = [];
  if (invoiceCount) deleteBlockers.push(`${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'}`);
  if (billCount) deleteBlockers.push(`${billCount} bill${billCount === 1 ? '' : 's'}`);
  if (expenseCount) deleteBlockers.push(`${expenseCount} expense${expenseCount === 1 ? '' : 's'}`);
  if (timesheetCount)
    deleteBlockers.push(`${timesheetCount} timesheet ${timesheetCount === 1 ? 'entry' : 'entries'}`);
  if (dealCount) deleteBlockers.push(`${dealCount} converted deal${dealCount === 1 ? '' : 's'}`);

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/projects" className="text-ink-3 hover:text-ink">
          ← Back to Projects
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {project.code}
            </Badge>
            <h1 className="text-xl font-semibold text-ink">{project.name}</h1>
            <Badge variant={STAGE_VARIANT[project.stage] ?? 'outline'} className="capitalize">
              {project.stage}
            </Badge>
            {canSeeCommercials && pnl && pnl.margin >= 0 && pnl.contractValue > 0 && (
              <span className="text-xs text-status-green">
                · margin {Math.round((pnl.margin / Math.max(1, pnl.revenue.invoiced + pnl.revenue.wip || pnl.contractValue)) * 100)}%
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-ink-3">
            Client:{' '}
            <Link
              href={`/directory/clients/${project.client.id}`}
              className="hover:underline"
            >
              <span className="font-mono">{project.client.code}</span>{' '}
              <span>{project.client.legalName}</span>
            </Link>
            {' · '}
            <span>
              Lead{' '}
              <Link
                href={`/directory/people/${project.primaryPartner.id}`}
                className="hover:underline"
              >
                {project.primaryPartner.firstName} {project.primaryPartner.lastName}
              </Link>
            </span>
            {' · '}
            <span>
              PM{' '}
              <Link
                href={`/directory/people/${project.manager.id}`}
                className="hover:underline"
              >
                {project.manager.firstName} {project.manager.lastName}
              </Link>
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {/* Contract / budget pill is leadership-only. Staff don't
               see commercials at all on the project detail. */}
          {canSeeCommercials && (
            projectIsInternal ? (
              <div className="rounded-md border border-line bg-card px-3 py-1.5 text-right text-sm">
                <div className="text-[10px] uppercase tracking-wide text-ink-3">
                  Internal budget
                </div>
                <div className="text-base font-semibold tabular-nums text-ink">
                  {budget && budget.meta.hasBudget
                    ? formatMoney(budget.meta.totalFeeCents)
                    : '—'}
                </div>
                {(!budget || !budget.meta.hasBudget) && (
                  <div className="text-[10px] text-ink-3">no budget set</div>
                )}
              </div>
            ) : (
              <div className="rounded-md border border-line bg-card px-3 py-1.5 text-right text-sm">
                <div className="text-[10px] uppercase tracking-wide text-ink-3">
                  Contract
                </div>
                <div className="text-base font-semibold tabular-nums text-ink">
                  {formatMoney(project.contractValue)}
                </div>
              </div>
            )
          )}
          {/* Draft-invoice CTAs live exclusively on the Invoices tab now —
              keeping them in the header alongside Settings/Archive felt
              cluttered and duplicated the choices. The Invoices tab opens
              with a clear two-card chooser explaining each option. */}
          {hasAnyRole(session, ['super_admin', 'admin']) && (
            <Link
              href={`/projects/${project.code}/tracker`}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
            >
              Financial Tracker
            </Link>
          )}
          <Link
            href={`/projects/${project.code}/settings`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            Settings
          </Link>
          {canEditProject &&
            (project.stage === 'archived' ? (
              <ReactivateProjectButton projectId={project.id} />
            ) : (
              <ArchiveProjectButton
                projectId={project.id}
                projectCode={project.code}
                projectName={project.name}
                deleteBlockers={deleteBlockers}
                canDelete={canDeleteProject}
              />
            ))}
        </div>
      </header>

      {project.stage === 'archived' && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-sm text-status-amber">
          This project is archived (actual end{' '}
          {project.actualEndDate?.toLocaleDateString('en-AU') ?? '—'}). Read-only until
          reactivated.
        </div>
      )}

      {/* Theoretical-date reminder banner removed 2026-07-02 — dates
          are no longer a gate on closing/archived, so the nag was
          just noise. Missing dates still surface in the reconcile
          gap queue if TT wants to backfill them systematically. */}
      {projectIsInternal && project.stage !== 'archived' && (
        <div className="rounded-md border border-line bg-surface-subtle/50 px-3 py-2 text-sm text-ink-2">
          <strong>Internal project · FHP series.</strong> No client revenue —
          tracked against the internal budget below, not a P&amp;L. Start /
          end dates are optional (most FHP projects are standing or
          episodic).
        </div>
      )}

      <Tabs defaultValue={initialTab}>
        {/* Tabs grouped into three labelled rows so the project surface
             stays scannable. Rendering three TabsList blocks side-by-
             side under the same Tabs root works because shadcn's
             TabsContent matches by `value` regardless of which list the
             trigger sits in. Labels above each row anchor the cohort. */}
        <div className="space-y-2">
          <TabRow label="Project Ops">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="milestones">Milestones</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="risks">
              Risks ({overviewExtras.riskSummary.open})
            </TabsTrigger>
            <TabsTrigger value="checklists">
              Checklists ({project.checklists.length})
            </TabsTrigger>
          </TabRow>
          <TabRow label="Tracking">
            <TabsTrigger value="team">
              Team ({project.team.length})
            </TabsTrigger>
            <TabsTrigger value="hours">
              Hours ({projectTimesheetEntries.length})
            </TabsTrigger>
          </TabRow>
          {/* Staff (no leader role) don't see the Commercials row at
               all — all P&L / Budget / Invoices / Expenses surfaces
               are project-leadership only. They still see Project
               Ops (Overview / Milestones / Files / Risks / Checklists)
               and Tracking (Team / Hours). */}
          {canSeeCommercials && (
            <TabRow label={projectIsInternal ? 'Budget' : 'Commercials'}>
              {/* Internal FHP projects have no client revenue → no P&L
                   and no invoicing. Just budget vs. actuals + the
                   expenses tagged against them. Client projects keep
                   the full Commercials surface. */}
              {!projectIsInternal && (
                <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
              )}
              <TabsTrigger value="budget">Budget</TabsTrigger>
              {!projectIsInternal && (
                <TabsTrigger value="invoices">
                  Invoices ({projectInvoices.length})
                </TabsTrigger>
              )}
              <TabsTrigger value="expenses">
                Submitted expenses ({projectExpenses.length + projectBills.length})
              </TabsTrigger>
            </TabRow>
          )}
        </div>

        <TabsContent value="overview">
          <ProjectOverviewTab
            project={project}
            pnl={pnl}
            extras={overviewExtras}
            timesheetEntryCount={projectTimesheetEntries.length}
            teamAddOptions={teamAddOptions}
            canEditProject={canEditProject}
            canSeePnL={canSeePnL}
            canSeeCommercials={canSeeCommercials}
            canCreateInvoice={hasCapability(session, 'invoice.create')}
            isInternal={projectIsInternal}
            budgetTotalForecastCents={
              budget?.meta.hasBudget ? budget.meta.totalFeeCents : null
            }
            budgetActualsCents={budget?.actuals.totalCents ?? null}
          />
        </TabsContent>

        <TabsContent value="team">
          {teamUtil ? (
            <div className="space-y-4">
              <ProjectTeamSection
                projectId={project.id}
                projectCode={project.code}
                rows={teamUtil.rows}
                totals={teamUtil.totals}
                allPeople={peopleOptionsRaw}
                canEdit={canEditProject}
              />
              <ProjectContributionsEditor
                projectId={project.id}
                partners={partnerOptions}
                initial={contributionRows.map((c) => ({
                  personId: c.personId,
                  role: c.role,
                  contributionPct: c.contributionPct,
                  notes: c.notes,
                }))}
                canEdit={canEditProject}
              />
            </div>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Team ({project.team.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {project.team.length === 0 ? (
                  <p className="text-sm text-ink-3">No team yet.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {project.team.map((t) => (
                      <li key={t.id} className="flex items-center gap-2">
                        <PersonAvatar
  className="h-7 w-7"
  fallbackClassName="text-[10px]"
  initials={t.person.initials}
  headshotUrl={t.person.headshotUrl}
/>
                        <span className="font-medium text-ink">
                          {t.person.firstName} {t.person.lastName}
                        </span>
                        <span className="text-ink-3">· {t.roleOnProject}</span>
                        <span className="text-ink-3">· {t.allocationPct}%</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="milestones">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Milestones ({project.milestones.length})</CardTitle>
              <Link
                href={`/projects/${project.code}/milestones`}
                className="text-sm text-brand hover:underline"
              >
                Manage →
              </Link>
            </CardHeader>
            <CardContent>
              {project.milestones.length === 0 ? (
                <p className="text-sm text-ink-3">
                  No milestones yet.{' '}
                  <Link
                    href={`/projects/${project.code}/milestones`}
                    className="text-brand hover:underline"
                  >
                    Add one →
                  </Link>
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {project.milestones.map((m) => (
                    <li key={m.id} className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-ink">{m.label}</div>
                        <div className="text-xs text-ink-3">
                          {m.dueDate.toLocaleDateString('en-AU')} · {m.status}
                        </div>
                      </div>
                      <span className="tabular-nums text-ink-2">{formatMoney(m.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="hours">
          <ProjectHoursPanel
            projectCode={project.code}
            entries={projectTimesheetEntries}
            canSeePnL={canSeePnL}
          />
        </TabsContent>

        <TabsContent value="invoices">
          {hasCapability(session, 'invoice.create') && project.stage !== 'archived' && (
            <DraftInvoiceChooser projectCode={project.code} />
          )}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Invoices ({projectInvoices.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {projectInvoices.length === 0 ? (
                <p className="py-6 text-center text-sm text-ink-3">
                  No invoices yet.
                </p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {projectInvoices.map((inv) => (
                    <li key={inv.id} className="flex items-center justify-between py-2">
                      <div>
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="font-mono text-xs text-ink hover:underline"
                        >
                          {inv.number}
                        </Link>
                        <span className="ml-2 text-xs text-ink-3">
                          {inv.issueDate.toLocaleDateString('en-AU')}
                        </span>
                        {inv.paidAt && (
                          <span className="ml-2 text-xs text-status-green">
                            paid {inv.paidAt.toLocaleDateString('en-AU')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="capitalize">
                          {inv.status}
                        </Badge>
                        <span className="font-semibold tabular-nums text-ink">
                          {formatMoney(inv.amountTotal)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses">
          <ProjectExpensesTab
            project={{
              id: project.id,
              code: project.code,
              stage: project.stage,
            }}
            expenses={projectExpenses}
            bills={projectBills}
            billPersonById={billPersonById}
            billCreatorByBillId={billCreatorByBillId}
            canLogExpense={
              hasCapability(session, 'expense.submit') && project.stage !== 'archived'
            }
          />
        </TabsContent>

        <TabsContent value="checklists">
          <ProjectChecklistsPanel
            projectId={project.id}
            checklists={project.checklists.map((cl) => ({
              id: cl.id,
              label: cl.label,
              items: cl.items.map((i) => ({
                id: i.id,
                label: i.label,
                done: i.done,
                doneAt: i.doneAt,
              })),
            }))}
            canEdit={canEditProject}
          />
        </TabsContent>

        <TabsContent value="pnl">
          {!pnl ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-ink-3">
                P&amp;L is visible to Super Admin / Admin / owning Partner / owning Manager only.
              </CardContent>
            </Card>
          ) : (
            <ProjectPnLPanel pnl={pnl} />
          )}
        </TabsContent>

        <TabsContent value="budget">
          {!budget ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-ink-3">
                Budget is visible to Super Admin / Admin / owning Partner /
                owning Manager only.
              </CardContent>
            </Card>
          ) : (
            <ProjectBudgetSection
              projectId={project.id}
              hasBudget={budget.meta.hasBudget}
              meta={budget.meta}
              lines={budget.lines.map((l) => ({
                id: l.id,
                category: l.category,
                description: l.description,
                rateCents: l.rateCents,
                unitsPerWeek: l.unitsPerWeek,
                weeks: l.weeks,
                comment: l.comment,
                forecastCents: l.forecastCents,
                actualCents: l.actualCents,
                variancePct: l.variancePct,
              }))}
              totalsActualCents={budget.actuals.totalCents}
              canEdit={canEditProject}
              primaryPartnerName={`${project.primaryPartner.firstName} ${project.primaryPartner.lastName}`}
            />
          )}
        </TabsContent>

        <TabsContent value="risks">
          <Card>
            <CardContent className="py-6 text-center text-sm text-ink-3">
              Risk register is managed on its own page.{' '}
              <Link
                href={`/projects/${project.code}/risks`}
                className="text-brand hover:underline"
              >
                Open risk register →
              </Link>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="files">
          <Card>
            <CardContent className="space-y-3 py-8 text-center text-sm text-ink-3">
              {project.sharepointFolderUrl || project.sharepointAdminFolderUrl ? (
                <div className="flex flex-col items-center gap-3">
                  {project.sharepointFolderUrl && (
                    <a
                      href={project.sharepointFolderUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand hover:underline"
                    >
                      Open team folder (delivery + working) →
                    </a>
                  )}
                  {project.sharepointAdminFolderUrl && (
                    <a
                      href={project.sharepointAdminFolderUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand hover:underline"
                    >
                      Open admin folder (invoices + receipts + payments) →
                    </a>
                  )}
                  <ProvisionSharePointButton projectCode={project.code} hasExisting />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <span>No SharePoint folders yet.</span>
                  <ProvisionSharePointButton projectCode={project.code} />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2 py-1">
      <div className="text-ink-3">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}

function PersonRow({
  label,
  p,
}: {
  label: string;
  p: {
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  };
}) {
  return (
    <div>
      <div className="text-xs text-ink-3">{label}</div>
      <Link
        href={`/directory/people/${p.id}`}
        className="mt-1 flex items-center gap-2 hover:text-ink"
      >
        <PersonAvatar
  className="h-7 w-7"
  fallbackClassName="text-[10px]"
  initials={p.initials}
  headshotUrl={p.headshotUrl}
/>
        <span className="font-medium text-ink">
          {p.firstName} {p.lastName}
        </span>
      </Link>
    </div>
  );
}

// ─── Draft-invoice chooser (Invoices tab) ─────────────────────────────
//
// Two ways to bill a client; this card explains the choice in plain
// English so the partner doesn't have to remember which path is which.
//
//   "From timesheets" — Time & Materials engagement. Hours approved on
//   the project, multiplied by each person's bill rate, become invoice
//   line items. Picks up only entries not already on a previous invoice
//   so you can't bill the same hours twice.
//
//   "From milestones" — Fixed-fee engagement. Each completed milestone
//   becomes a line item at its agreed amount. Marks the milestone as
//   invoiced so it won't be picked again.
//
// Both flows also surface any project costs marked ↪ Rebillable as
// pre-checked pass-through line items, so a cost-plus engagement uses
// "From timesheets" and a fixed-fee with rebillables uses "From
// milestones" — same pass-through behaviour either way.
function DraftInvoiceChooser({ projectCode }: { projectCode: string }) {
  return (
    <Card className="mb-4 border-brand/40 bg-brand/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Draft a new client invoice</CardTitle>
        <CardDescription>
          Pick the source that matches this engagement&apos;s contract. Any
          rebillable pass-through costs surface in either flow.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Link
          href={`/projects/${projectCode}/draft-invoice`}
          className="group rounded-md border border-line bg-card p-3 hover:border-brand hover:bg-surface-hover"
        >
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-ink">From timesheets</div>
            <span className="text-brand group-hover:translate-x-0.5 transition-transform">
              →
            </span>
          </div>
          <p className="mt-1 text-[11px] text-ink-3">
            Bills approved hours × bill rate. Use for{' '}
            <strong>time &amp; materials</strong> engagements. Excludes hours
            already on a previous invoice.
          </p>
        </Link>
        <Link
          href={`/projects/${projectCode}/draft-milestone-invoice`}
          className="group rounded-md border border-line bg-card p-3 hover:border-brand hover:bg-surface-hover"
        >
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-ink">From milestones</div>
            <span className="text-brand group-hover:translate-x-0.5 transition-transform">
              →
            </span>
          </div>
          <p className="mt-1 text-[11px] text-ink-3">
            Bills agreed milestone amounts. Use for <strong>fixed-fee</strong>{' '}
            engagements. Marks each picked milestone as invoiced.
          </p>
        </Link>
      </CardContent>
    </Card>
  );
}

// ─── Consolidated Expenses tab ──────────────────────────────────────────
//
// One panel that lists every cost tied to this project, regardless of
// where it came from:
//   - "Individual" lines  → personal reimbursable expenses (Expense rows)
//                            — staff member paid out of pocket, expects pay-back
//   - "Project (vendor)"  → supplier bills (Bill rows) tagged to the project
//                            — Foundry pays the supplier directly
//
// Both kinds get a unified payment-state badge so the user can tell at a
// glance whether each cost is sitting in approval, queued for ABA, or
// already paid out.

type ExpensesTabExpense = {
  id: string;
  date: Date;
  amount: number;
  gst: number;
  category: string;
  description: string | null;
  status: string;
  rebillable: boolean;
  rebilledOnInvoiceId: string | null;
  person: { initials: string; firstName: string; lastName: string };
};

type ExpensesTabBill = {
  id: string;
  supplierPersonId: string | null;
  supplierName: string | null;
  supplierInvoiceNumber: string | null;
  issueDate: Date;
  amountTotal: number;
  gst: number;
  category: string;
  status: string;
  receivedVia: string;
  rebillable: boolean;
  rebilledOnInvoiceId: string | null;
  createdAt: Date;
};

type CostKind = 'individual' | 'project';
type PaymentStage =
  | 'pending_review'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'aba_queued'
  | 'paid';

type CostLine = {
  key: string;
  kind: CostKind;
  date: Date;
  /** Person who'll get reimbursed (individual) or who uploaded the bill (project). */
  submitterLabel: string;
  submitterInitials: string;
  /** What was bought (description) or counterparty (vendor / supplier). */
  primaryLabel: string;
  /** Smaller second-line context — invoice ref, receivedVia, etc. */
  secondaryLabel: string | null;
  category: string;
  amountIncGstCents: number;
  gstCents: number;
  rawStatus: string;
  paymentStage: PaymentStage;
  /** Rebill state: 'absorbed' = Foundry absorbs (default), 'rebillable'
   *  = flagged to pass through but not yet on an invoice, 'billed' =
   *  forwarded onto a client invoice (rebilledOnInvoiceId set). Drives
   *  the rebill chip in the row template + the "outstanding" filter. */
  rebillState: 'absorbed' | 'rebillable' | 'billed';
  rebilledOnInvoiceId: string | null;
  href: string;
};

function expenseToPaymentStage(status: string): PaymentStage {
  if (status === 'reimbursed') return 'paid';
  if (status === 'batched_for_payment') return 'aba_queued';
  if (status === 'approved') return 'approved';
  if (status === 'submitted') return 'submitted';
  if (status === 'rejected') return 'rejected';
  return 'submitted'; // draft / unknown — treat as in-flight
}

function billToPaymentStage(status: string): PaymentStage {
  if (status === 'paid') return 'paid';
  if (status === 'scheduled_for_payment') return 'aba_queued';
  if (status === 'approved') return 'approved';
  if (status === 'rejected') return 'rejected';
  return 'pending_review';
}

function PaymentStageBadge({ stage }: { stage: PaymentStage }) {
  const map: Record<PaymentStage, { label: string; variant: 'amber' | 'green' | 'blue' | 'red' | 'outline' }> = {
    pending_review: { label: 'Pending review', variant: 'amber' },
    submitted: { label: 'Submitted', variant: 'amber' },
    approved: { label: 'Approved', variant: 'blue' },
    rejected: { label: 'Rejected', variant: 'red' },
    aba_queued: { label: 'ABA · scheduled', variant: 'blue' },
    paid: { label: 'Paid', variant: 'green' },
  };
  const m = map[stage];
  return (
    <Badge variant={m.variant} className="text-[10px]">
      {m.label}
    </Badge>
  );
}

function ProjectExpensesTab({
  project,
  expenses,
  bills,
  billPersonById,
  billCreatorByBillId,
  canLogExpense,
}: {
  project: { id: string; code: string; stage: string };
  expenses: ExpensesTabExpense[];
  bills: ExpensesTabBill[];
  billPersonById: Map<string, { firstName: string; lastName: string; initials: string }>;
  billCreatorByBillId: Map<
    string,
    { id: string; firstName: string; lastName: string; initials: string }
  >;
  canLogExpense: boolean;
}) {
  // Build the unified row list, sorted newest-first by primary date.
  const lines: CostLine[] = [
    ...expenses.map<CostLine>((e) => ({
      key: `e:${e.id}`,
      kind: 'individual',
      date: e.date,
      submitterLabel: `${e.person.firstName} ${e.person.lastName}`,
      submitterInitials: e.person.initials,
      primaryLabel: e.description ?? '(no description)',
      secondaryLabel: null,
      category: e.category,
      amountIncGstCents: e.amount, // Expense.amount is inc-GST
      gstCents: e.gst,
      rawStatus: e.status,
      paymentStage: expenseToPaymentStage(e.status),
      rebillState: e.rebilledOnInvoiceId
        ? 'billed'
        : e.rebillable
          ? 'rebillable'
          : 'absorbed',
      rebilledOnInvoiceId: e.rebilledOnInvoiceId,
      href: `/expenses/${e.id}`,
    })),
    ...bills.map<CostLine>((b) => {
      const personSupplier = b.supplierPersonId
        ? billPersonById.get(b.supplierPersonId)
        : null;
      const supplierLabel = personSupplier
        ? `${personSupplier.firstName} ${personSupplier.lastName}`
        : (b.supplierName ?? '(unknown supplier)');
      const creator = billCreatorByBillId.get(b.id);
      return {
        key: `b:${b.id}`,
        kind: 'project',
        date: b.issueDate,
        submitterLabel: creator
          ? `${creator.firstName} ${creator.lastName}`
          : 'AP intake',
        submitterInitials: creator ? creator.initials : 'AP',
        primaryLabel: supplierLabel,
        secondaryLabel: b.supplierInvoiceNumber
          ? b.supplierInvoiceNumber
          : `via ${b.receivedVia}`,
        category: b.category,
        amountIncGstCents: b.amountTotal, // Bill.amountTotal is inc-GST
        gstCents: b.gst,
        rawStatus: b.status,
        paymentStage: billToPaymentStage(b.status),
        rebillState: b.rebilledOnInvoiceId
          ? 'billed'
          : b.rebillable
            ? 'rebillable'
            : 'absorbed',
        rebilledOnInvoiceId: b.rebilledOnInvoiceId,
        href: `/bills/intake?id=${b.id}`,
      };
    }),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  // Summary totals — useful to see at a glance how much is queued vs paid
  // and split across individual vs vendor.
  const totals = {
    all: lines.reduce((s, l) => s + l.amountIncGstCents, 0),
    individual: lines
      .filter((l) => l.kind === 'individual')
      .reduce((s, l) => s + l.amountIncGstCents, 0),
    project: lines
      .filter((l) => l.kind === 'project')
      .reduce((s, l) => s + l.amountIncGstCents, 0),
    abaQueued: lines
      .filter((l) => l.paymentStage === 'aba_queued')
      .reduce((s, l) => s + l.amountIncGstCents, 0),
    paid: lines
      .filter((l) => l.paymentStage === 'paid')
      .reduce((s, l) => s + l.amountIncGstCents, 0),
  };
  const counts = {
    individual: lines.filter((l) => l.kind === 'individual').length,
    project: lines.filter((l) => l.kind === 'project').length,
    abaQueued: lines.filter((l) => l.paymentStage === 'aba_queued').length,
    paid: lines.filter((l) => l.paymentStage === 'paid').length,
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Submitted Expenses ({lines.length})</CardTitle>
          <CardDescription>
            Individual reimbursements + supplier bills tagged to{' '}
            <span className="font-mono">{project.code}</span>.
          </CardDescription>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {canLogExpense && (
            <>
              <Link
                href={`/bills/intake`}
                className="text-brand hover:underline"
              >
                + Drop receipt (OCR)
              </Link>
              <span className="text-ink-4">·</span>
              <Link
                href={`/expenses/new?projectId=${project.id}`}
                className="text-brand hover:underline"
              >
                + Log expense
              </Link>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {lines.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">
            No costs tagged to this project yet.{' '}
            {canLogExpense && (
              <>
                Drop a receipt on{' '}
                <Link href="/bills/intake" className="text-brand hover:underline">
                  intake
                </Link>{' '}
                or{' '}
                <Link
                  href={`/expenses/new?projectId=${project.id}`}
                  className="text-brand hover:underline"
                >
                  log an expense
                </Link>
                .
              </>
            )}
          </p>
        ) : (
          <>
            {/* Summary cards — split by kind + payment stage. */}
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <SummaryCard
                label="Total"
                amount={totals.all}
                sub={`${lines.length} item${lines.length === 1 ? '' : 's'}`}
              />
              <SummaryCard
                label="Individual"
                amount={totals.individual}
                sub={`${counts.individual} reimbursement${counts.individual === 1 ? '' : 's'}`}
                tone="blue"
              />
              <SummaryCard
                label="Project (vendor)"
                amount={totals.project}
                sub={`${counts.project} bill${counts.project === 1 ? '' : 's'}`}
                tone="amber"
              />
              <SummaryCard
                label="ABA scheduled"
                amount={totals.abaQueued}
                sub={`${counts.abaQueued} pending pay run`}
                tone={counts.abaQueued > 0 ? 'amber' : 'neutral'}
              />
              <SummaryCard
                label="Paid"
                amount={totals.paid}
                sub={`${counts.paid} reconciled`}
                tone={counts.paid > 0 ? 'green' : 'neutral'}
              />
            </div>

            <ul className="divide-y divide-line text-sm">
              {lines.map((l) => (
                <li
                  key={l.key}
                  className="flex flex-wrap items-start justify-between gap-3 py-2"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarFallback className="text-[10px]">
                        {l.submitterInitials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <KindPill kind={l.kind} />
                        <Link
                          href={l.href}
                          className="truncate font-medium text-ink hover:underline"
                        >
                          {l.primaryLabel}
                        </Link>
                        {l.secondaryLabel && (
                          <span className="font-mono text-[11px] text-ink-3">
                            {l.secondaryLabel}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-ink-3">
                        {l.date.toLocaleDateString('en-AU')} ·{' '}
                        <span className="capitalize">{l.category}</span> ·
                        submitted by{' '}
                        <span className="text-ink-2">{l.submitterLabel}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <RebillStateBadge
                      state={l.rebillState}
                      rebilledOnInvoiceId={l.rebilledOnInvoiceId}
                    />
                    <PaymentStageBadge stage={l.paymentStage} />
                    <div className="text-right">
                      <div className="font-semibold tabular-nums text-ink">
                        {formatMoney(l.amountIncGstCents)}
                      </div>
                      {l.gstCents > 0 && (
                        <div className="text-[10px] text-ink-3">
                          incl. {formatMoney(l.gstCents)} GST
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryCard({
  label,
  amount,
  sub,
  tone = 'neutral',
}: {
  label: string;
  amount: number;
  sub: string;
  tone?: 'neutral' | 'blue' | 'amber' | 'green';
}) {
  const subColor =
    tone === 'blue'
      ? 'text-status-blue'
      : tone === 'amber'
        ? 'text-status-amber'
        : tone === 'green'
          ? 'text-status-green'
          : 'text-ink-3';
  return (
    <div className="rounded-md border border-line bg-card px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold tabular-nums text-ink">
        {formatMoney(amount)}
      </div>
      <div className={`text-[11px] ${subColor}`}>{sub}</div>
    </div>
  );
}

/**
 * Per-row badge surfacing the rebill state:
 *   - **absorbed** — Foundry eats the cost (default for opex). Neutral grey.
 *   - **rebillable** — flagged to pass through but not yet on an
 *     invoice → outstanding. Amber.
 *   - **billed** — already forwarded onto a client invoice → complete.
 *     Green, links straight to the invoice if we have its id.
 *
 * Surfaces directly next to the payment-stage badge in the expenses
 * tab so partners see the rebill journey alongside the AP one.
 */
function RebillStateBadge({
  state,
  rebilledOnInvoiceId,
}: {
  state: 'absorbed' | 'rebillable' | 'billed';
  rebilledOnInvoiceId: string | null;
}) {
  if (state === 'billed') {
    const inner = (
      <span className="rounded-full bg-status-green-soft px-1.5 py-0.5 text-[10px] font-medium text-status-green">
        ✓ Billed
      </span>
    );
    return rebilledOnInvoiceId ? (
      <Link
        href={`/invoices/${rebilledOnInvoiceId}`}
        className="hover:underline"
        title="Forwarded onto a client invoice — click to open"
      >
        {inner}
      </Link>
    ) : (
      inner
    );
  }
  if (state === 'rebillable') {
    return (
      <span
        className="rounded-full bg-status-amber-soft px-1.5 py-0.5 text-[10px] font-medium text-status-amber"
        title="Marked rebillable — waiting on the next client invoice"
      >
        → Client (pending)
      </span>
    );
  }
  return (
    <span
      className="rounded-full bg-surface-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink-3"
      title="Foundry absorbs this cost — not forwarded to the client"
    >
      FH absorbs
    </span>
  );
}

function KindPill({ kind }: { kind: CostKind }) {
  if (kind === 'individual') {
    return (
      <span className="rounded-full bg-status-blue-soft px-1.5 py-0.5 text-[10px] font-medium text-status-blue">
        ↩ Individual
      </span>
    );
  }
  return (
    <span className="rounded-full bg-status-amber-soft px-1.5 py-0.5 text-[10px] font-medium text-status-amber">
      🏷 Project
    </span>
  );
}

function ProjectPnLPanel({ pnl }: { pnl: ProjectPnL }) {
  const totalRevenue = pnl.revenue.invoiced + pnl.revenue.wip;
  const totalCost =
    pnl.cost.timesheet +
    pnl.cost.contractorInvoice +
    pnl.cost.expense +
    pnl.cost.bill;
  const hasActivity = totalRevenue > 0 || totalCost > 0 || pnl.hours > 0;
  const marginPct =
    totalRevenue > 0 ? Math.round((pnl.margin / totalRevenue) * 100) : null;
  const maxMonthly = Math.max(
    1,
    ...pnl.monthly.flatMap((m) => [m.revenue, m.cost]),
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-ink-3">Contract value</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold tabular-nums text-ink">
            {formatMoney(pnl.contractValue)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-ink-3">Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold tabular-nums text-ink">
              {formatMoney(totalRevenue)}
            </div>
            <div className="text-xs text-ink-3">
              {formatMoney(pnl.revenue.invoiced)} invoiced ·{' '}
              {formatMoney(pnl.revenue.wip)} WIP
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-ink-3">Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold tabular-nums text-ink">
              {formatMoney(totalCost)}
            </div>
            <div className="text-xs text-ink-3">
              {formatMoney(pnl.cost.timesheet + pnl.cost.contractorInvoice)} labour ·{' '}
              {formatMoney(pnl.cost.expense)} exp · {formatMoney(pnl.cost.bill)} bills
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-ink-3">Margin</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-lg font-semibold tabular-nums ${
                pnl.margin >= 0 ? 'text-ink' : 'text-status-red'
              }`}
            >
              {formatMoney(pnl.margin)}
            </div>
            <div className="text-xs text-ink-3">
              {marginPct === null ? '—' : `${marginPct}% of revenue`} ·{' '}
              {pnl.hours.toFixed(1)} hrs logged
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {!hasActivity ? (
            <p className="py-6 text-center text-sm text-ink-3">
              No activity yet. Log time, approve an invoice, or submit an expense to start
              populating the P&amp;L.
            </p>
          ) : pnl.monthly.length === 0 ? (
            <p className="text-sm text-ink-3">No monthly data yet.</p>
          ) : (
            <div className="space-y-2">
              {pnl.monthly.map((m) => (
                <div key={m.month} className="grid grid-cols-[80px_1fr_1fr] items-center gap-3">
                  <span className="font-mono text-xs text-ink-3">{m.month}</span>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 rounded bg-status-green"
                      style={{ width: `${Math.round((m.revenue / maxMonthly) * 100)}%` }}
                      aria-label={`Revenue ${formatMoney(m.revenue)}`}
                    />
                    <span className="tabular-nums text-xs text-ink-2">
                      {formatMoney(m.revenue)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 rounded bg-status-red"
                      style={{ width: `${Math.round((m.cost / maxMonthly) * 100)}%` }}
                      aria-label={`Cost ${formatMoney(m.cost)}`}
                    />
                    <span className="tabular-nums text-xs text-ink-2">
                      {formatMoney(m.cost)}
                    </span>
                  </div>
                </div>
              ))}
              <div className="mt-2 flex gap-4 text-xs text-ink-3">
                <span>
                  <span className="inline-block h-2 w-2 rounded bg-status-green" /> Revenue
                </span>
                <span>
                  <span className="inline-block h-2 w-2 rounded bg-status-red" /> Cost
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Per-project waterfall — same component as the firm view, scoped to a
 * single project's revenue cascade. Steps stop at gross margin (no
 * project-level OPEX / tax). Shown only when the user has P&L access.
 *
 *   Booked → -Unbilled → Invoiced → -Cost → Margin
 *
 * Where:
 *   Booked    = Project.contractValue
 *   Unbilled  = Booked − Invoiced (covers genuine WIP + future work
 *               not yet invoiced; surfaced negatively in the cascade)
 *   Invoiced  = sum of approved/sent/partial/paid invoice ex-GST
 *   Cost      = timesheet × rate + approved expenses + approved bills
 *   Margin    = Invoiced − Cost  (realised margin to date)
 */
function ProjectWaterfallCard({
  contractValueCents,
  invoicedCents,
  wipInvoicesCents,
  costCents,
}: {
  contractValueCents: number;
  invoicedCents: number;
  /** Drafts + pending-approval invoices — surfaced in the sub-line for
   *  context but the cascade uses Booked − Invoiced for the deduction. */
  wipInvoicesCents: number;
  costCents: number;
}) {
  const unbilled = Math.max(0, contractValueCents - invoicedCents);
  const margin = invoicedCents - costCents;
  const steps: WaterfallStep[] = [
    {
      key: 'booked',
      label: 'Booked',
      sub: 'contract value',
      valueCents: contractValueCents,
      kind: 'total',
      tone: 'brand',
    },
    {
      key: 'unbilled',
      label: 'Unbilled',
      sub:
        wipInvoicesCents > 0
          ? `${formatMoney(wipInvoicesCents)} draft / pending`
          : 'WIP + future work',
      valueCents: -unbilled,
      kind: 'flow',
      tone: 'orange',
    },
    {
      key: 'invoiced',
      label: 'Invoiced',
      sub: 'approved / sent / paid',
      valueCents: invoicedCents,
      kind: 'subtotal',
      tone: 'brand',
    },
    {
      key: 'cost',
      label: 'Cost',
      sub: 'time + expenses + bills',
      valueCents: -costCents,
      kind: 'flow',
      tone: 'orange',
    },
    {
      key: 'margin',
      label: 'Margin',
      sub: 'invoiced − cost',
      valueCents: margin,
      kind: 'total',
      tone: margin >= 0 ? 'green' : 'red',
    },
  ];
  // Skip the chart entirely when there's literally nothing to show
  // (no contract value AND no activity) so kickoff projects don't get
  // an empty rectangle.
  if (
    contractValueCents === 0 &&
    invoicedCents === 0 &&
    costCents === 0
  ) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project waterfall</CardTitle>
        <CardDescription>
          Booked contract → invoiced → cost → realised margin. Same
          cascade shape as the firm view, scoped to this project.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <WaterfallChart steps={steps} height={280} />
      </CardContent>
    </Card>
  );
}


/**
 * Wraps a row of `<TabsTrigger>`s with a small uppercase group label
 * on the left so the project surface reads as three cohorts (Project
 * Ops / Tracking / Commercials) instead of one long bar of tabs. Uses
 * `<TabsList>` underneath so shadcn's keyboard navigation + active
 * state still work end-to-end.
 */
function TabRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-[88px] shrink-0 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
        {label}
      </span>
      <TabsList className="flex-wrap">{children}</TabsList>
    </div>
  );
}

// ─── Overview tab helpers ───────────────────────────────────────────────

function ProjectOverviewTab({
  project,
  pnl,
  extras,
  timesheetEntryCount,
  teamAddOptions,
  canEditProject,
  canSeePnL,
  canSeeCommercials,
  canCreateInvoice,
  isInternal,
  budgetTotalForecastCents,
  budgetActualsCents,
}: {
  project: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    stage: string;
    contractValue: number;
    currency: string;
    startDate: Date | null;
    endDate: Date | null;
    actualEndDate: Date | null;
    sharepointFolderUrl: string | null;
    sharepointAdminFolderUrl: string | null;
    xeroTrackingCategoryValue: string | null;
    primaryPartner: {
      id: string;
      initials: string;
      firstName: string;
      lastName: string;
      headshotUrl: string | null;
    };
    manager: {
      id: string;
      initials: string;
      firstName: string;
      lastName: string;
      headshotUrl: string | null;
    };
    team: Array<{
      id: string;
      personId: string;
      roleOnProject: string;
      allocationPct: number;
      person: {
        id: string;
        initials: string;
        firstName: string;
        lastName: string;
        band: string;
        headshotUrl: string | null;
      };
    }>;
  };
  pnl: ProjectPnL | null;
  extras: Awaited<ReturnType<typeof computeProjectOverviewExtras>>;
  timesheetEntryCount: number;
  teamAddOptions: Array<{
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
    band: string;
  }>;
  canEditProject: boolean;
  canSeePnL: boolean;
  /** Pure-staff viewers (no leader role) don't see commercials at
   *  all on the project detail — drops the KPI strip and waterfall
   *  to leave just the project-ops content. */
  canSeeCommercials: boolean;
  canCreateInvoice: boolean;
  /** Internal FHP project? Drives the "no contract / no P&L" branch
   *  in the KPI strip — Budget burn replaces Margin / AR. */
  isInternal: boolean;
  /** Total internal-budget forecast in cents (null when no budget
   *  has been set for the project yet). Only used when `isInternal`. */
  budgetTotalForecastCents: number | null;
  /** Internal-budget actuals (timesheet cost + bills + expenses).
   *  Null when no budget computation ran. */
  budgetActualsCents: number | null;
}) {
  // Derived metrics — keep null-safe so the panel renders even before P&L.
  const totalRev = pnl ? pnl.revenue.invoiced + pnl.revenue.wip : 0;
  const totalCost = pnl
    ? pnl.cost.timesheet + pnl.cost.contractorInvoice + pnl.cost.expense + pnl.cost.bill
    : 0;
  const expensePct =
    pnl && project.contractValue > 0
      ? Math.round(((pnl.cost.expense + pnl.cost.bill) / project.contractValue) * 100)
      : 0;
  const marginPct =
    pnl && totalRev > 0
      ? Math.round((pnl.margin / totalRev) * 100)
      : pnl && project.contractValue > 0
        ? Math.round(((project.contractValue - totalCost) / project.contractValue) * 100)
        : null;
  const arOpen = extras.invoiceSummary.totalOpenCents;

  // Weeks elapsed / total — feeds the Progress KpiTile.
  let weekIndex = 0;
  let weekTotal = 0;
  let progressPct = 0;
  if (project.startDate && project.endDate) {
    const ms = 24 * 3600 * 1000;
    const total = Math.max(
      1,
      Math.round(
        (project.endDate.getTime() - project.startDate.getTime()) / (7 * ms),
      ),
    );
    const elapsed = Math.max(
      0,
      Math.min(
        total,
        Math.round((Date.now() - project.startDate.getTime()) / (7 * ms)),
      ),
    );
    weekTotal = total;
    weekIndex = elapsed;
    progressPct = Math.round((elapsed / total) * 100);
  }

  // Internal-budget burn % when the project is internal AND a budget
  // has been recorded. Drives the "Budget burn" KPI tile that
  // replaces Margin / AR for FHP projects.
  const budgetBurnPct =
    isInternal &&
    budgetTotalForecastCents !== null &&
    budgetTotalForecastCents > 0 &&
    budgetActualsCents !== null
      ? Math.round((budgetActualsCents / budgetTotalForecastCents) * 100)
      : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {canSeeCommercials && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {isInternal ? (
            <>
              <KpiTile
                label="Hours logged"
                value={String(timesheetEntryCount)}
                sub={
                  timesheetEntryCount === 1 ? 'entry' : 'timesheet entries'
                }
                tone="neutral"
              />
              <KpiTile
                label="Budget"
                value={
                  budgetTotalForecastCents !== null
                    ? formatMoney(budgetTotalForecastCents)
                    : '—'
                }
                sub={
                  budgetTotalForecastCents !== null
                    ? 'forecast'
                    : 'no budget set'
                }
                tone="neutral"
              />
              <KpiTile
                label="Actuals"
                value={
                  budgetActualsCents !== null
                    ? formatMoney(budgetActualsCents)
                    : '—'
                }
                sub={
                  budgetTotalForecastCents !== null && budgetActualsCents !== null
                    ? `${formatMoney(
                        budgetTotalForecastCents - budgetActualsCents,
                      )} remaining`
                    : 'spent so far'
                }
                tone={
                  budgetBurnPct === null
                    ? 'neutral'
                    : budgetBurnPct >= 100
                      ? 'red'
                      : budgetBurnPct >= 80
                        ? 'amber'
                        : 'green'
                }
              />
              <KpiTile
                label="Budget burn"
                value={budgetBurnPct !== null ? `${budgetBurnPct}%` : '—'}
                sub={
                  budgetBurnPct === null
                    ? 'set a budget to track'
                    : budgetBurnPct >= 100
                      ? 'over budget'
                      : budgetBurnPct >= 80
                        ? 'nearly there'
                        : 'on track'
                }
                tone={
                  budgetBurnPct === null
                    ? 'neutral'
                    : budgetBurnPct >= 100
                      ? 'red'
                      : budgetBurnPct >= 80
                        ? 'amber'
                        : 'green'
                }
              />
            </>
          ) : (
          <>
          <KpiTile
            label="Progress"
            value={`${progressPct}%`}
            sub={
              weekTotal > 0
                ? `wk ${weekIndex} of ${weekTotal}`
                : project.startDate || project.endDate
                  ? 'partial dates'
                  : 'dates not set'
            }
            tone={progressPct > 100 ? 'red' : progressPct >= 80 ? 'green' : 'neutral'}
          />
          <KpiTile
            label="Expense"
            value={canSeePnL ? `${expensePct}%` : '—'}
            sub={
              canSeePnL
                ? `${formatMoney(pnl ? pnl.cost.expense + pnl.cost.bill : 0)} · ${
                    expensePct >= 60 ? 'over target' : 'of contract'
                  }`
                : 'P&L hidden'
            }
            tone={
              !canSeePnL
                ? 'neutral'
                : expensePct >= 60
                  ? 'red'
                  : expensePct >= 50
                    ? 'amber'
                    : 'green'
            }
          />
          <KpiTile
            label="Margin"
            value={canSeePnL && marginPct !== null ? `${marginPct}%` : '—'}
            sub={
              canSeePnL && pnl !== null
                ? `${formatMoney(pnl.margin)} · ${
                    marginPct === null
                      ? 'no revenue yet'
                      : marginPct >= 30
                        ? 'on target'
                        : marginPct >= 15
                          ? 'below target'
                          : 'squeezed'
                  }`
                : 'P&L hidden'
            }
            tone={
              !canSeePnL
                ? 'neutral'
                : marginPct === null
                  ? 'neutral'
                  : marginPct >= 30
                    ? 'green'
                    : marginPct >= 15
                      ? 'amber'
                      : 'red'
            }
          />
          <KpiTile
            label="Receivables open"
            value={canSeePnL ? formatMoney(arOpen) : '—'}
            sub={
              canSeePnL
                ? `${extras.invoiceSummary.overdueCount} overdue · ${
                    extras.invoiceSummary.sent + extras.invoiceSummary.approved
                  } in flight${
                    extras.invoiceSummary.paid > 0
                      ? ` · ${formatMoney(totalRev - arOpen)} paid`
                      : ''
                  }`
                : 'P&L hidden'
            }
            tone={
              !canSeePnL
                ? 'neutral'
                : extras.invoiceSummary.overdueCount > 0
                  ? 'red'
                  : arOpen > 0
                    ? 'amber'
                    : 'green'
            }
          />
          </>
          )}
        </div>
        )}

        {canSeeCommercials && !isInternal && canSeePnL && pnl && (
          <ProjectWaterfallCard
            contractValueCents={project.contractValue}
            invoicedCents={pnl.revenue.invoiced}
            wipInvoicesCents={pnl.revenue.wip}
            costCents={pnl.cost.timesheet + pnl.cost.contractorInvoice + pnl.cost.expense + pnl.cost.bill}
          />
        )}

        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>Team</CardTitle>
              <CardDescription>
                Lead + manager auto-anchor. Hours auto-bind on submit, but adding
                here makes resourcing accurate from day one.
              </CardDescription>
            </div>
            <span className="text-[11px] text-ink-3">
              Manage on the Team tab
            </span>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2 text-sm">
              <PersonRow label="Primary partner" p={project.primaryPartner} />
              <PersonRow label="Project manager" p={project.manager} />
            </div>
            {project.team.length === 0 ? (
              <p className="rounded-md border border-dashed border-line bg-surface-subtle/40 p-3 text-center text-xs text-ink-3">
                No additional team members yet. Add the people who&apos;ll log time
                so resourcing reflects actual capacity.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {project.team.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <Link
                      href={`/directory/people/${t.person.id}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <PersonAvatar
  className="h-7 w-7"
  fallbackClassName="text-[10px]"
  initials={t.person.initials}
  headshotUrl={t.person.headshotUrl}
/>
                      <div>
                        <div className="text-ink">
                          {t.person.firstName} {t.person.lastName}
                        </div>
                        <div className="text-[11px] text-ink-3">
                          {t.person.band} · {t.roleOnProject}
                        </div>
                      </div>
                    </Link>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-[10px] tabular-nums">
                        {t.allocationPct}%
                      </Badge>
                      {canEditProject && (
                        <RemoveTeamMemberButton
                          projectId={project.id}
                          personId={t.person.id}
                          personName={`${t.person.firstName} ${t.person.lastName}`}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {canEditProject && (
              <TeamQuickAdd projectId={project.id} options={teamAddOptions} />
            )}
          </CardContent>
        </Card>

        {project.description && (
          <Card>
            <CardHeader>
              <CardTitle>Brief</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-ink-2">
                {project.description}
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              Audit trail — invoices, approvals, team changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {extras.recentActivity.length === 0 ? (
              <p className="px-5 py-4 text-sm text-ink-3">
                No activity logged yet.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {extras.recentActivity.slice(0, 8).map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between gap-2 px-5 py-2 text-xs"
                  >
                    <div className="text-ink-2">
                      <span className="font-medium text-ink">{a.actor ?? 'System'}</span>{' '}
                      <span className="capitalize">{a.action.replace(/_/g, ' ')}</span>{' '}
                      <span className="text-ink-3">on {a.entityType}</span>
                    </div>
                    <span className="tabular-nums text-ink-4">
                      {a.at.toLocaleDateString('en-AU', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Approvals</CardTitle>
            <CardDescription>
              Pending invoice / expense / bill items tied to this project.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {extras.pendingApprovals.length === 0 ? (
              <p className="py-2 text-xs text-ink-3">Nothing pending.</p>
            ) : (
              extras.pendingApprovals.map((a) => (
                <Link
                  key={a.id}
                  href={a.href}
                  className="block rounded-md border border-line px-3 py-2 text-xs hover:bg-surface-hover"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink">{a.label}</span>
                    <span className="tabular-nums text-ink-2">
                      {formatMoney(a.amountCents)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-ink-3">
                    Needs {a.requiredRole.replace('_', ' ')} · {a.ageDays}d old
                  </div>
                </Link>
              ))
            )}
            {canCreateInvoice && project.stage !== 'archived' && (
              <Link
                href={`/projects/${project.code}/draft-invoice`}
                className="block text-center text-xs text-brand hover:underline"
              >
                + Draft invoice from approved hours
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoicing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <Row label="Draft">{extras.invoiceSummary.draft}</Row>
            <Row label="Pending approval">{extras.invoiceSummary.pending}</Row>
            <Row label="Approved / sent">
              {extras.invoiceSummary.approved + extras.invoiceSummary.sent}
            </Row>
            <Row label="Paid">{extras.invoiceSummary.paid}</Row>
            <Row label="Overdue">
              <span
                className={
                  extras.invoiceSummary.overdueCount > 0
                    ? 'text-status-red'
                    : 'text-ink-3'
                }
              >
                {extras.invoiceSummary.overdueCount}
              </span>
            </Row>
            <div className="mt-1 border-t border-line pt-2">
              <Row label="AR open">
                <span className="font-semibold tabular-nums text-ink">
                  {canSeePnL ? formatMoney(arOpen) : '—'}
                </span>
              </Row>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <CardTitle>Checklists</CardTitle>
            <span className="text-[10px] text-ink-3">
              {extras.checklistSummary.length}
            </span>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {extras.checklistSummary.length === 0 ? (
              <p className="text-ink-3">
                No checklists yet. Track delivery gates / sign-offs from the
                Checklists tab.
              </p>
            ) : (
              extras.checklistSummary.slice(0, 4).map((c) => (
                <div key={c.id} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-2">{c.label}</span>
                    <span className="tabular-nums text-ink-3">
                      {c.done}/{c.total}
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-surface-subtle">
                    <div
                      className="h-full bg-brand"
                      style={{ width: `${c.pct}%` }}
                    />
                  </div>
                </div>
              ))
            )}
            {extras.checklistSummary.length > 4 && (
              <p className="text-[10px] text-ink-3">
                +{extras.checklistSummary.length - 4} more
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Risks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <Row label="Open">
              <span
                className={
                  extras.riskSummary.high > 0
                    ? 'text-status-red'
                    : extras.riskSummary.open > 0
                      ? 'text-status-amber'
                      : 'text-status-green'
                }
              >
                {extras.riskSummary.open}
              </span>
            </Row>
            <Row label="High">{extras.riskSummary.high}</Row>
            <Row label="Medium">{extras.riskSummary.medium}</Row>
            <Row label="Low">{extras.riskSummary.low}</Row>
            <Link
              href={`/projects/${project.code}/risks`}
              className="mt-2 inline-block text-[11px] text-brand hover:underline"
            >
              Manage risk register →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <ActionLink
              href={`/projects/${project.code}/hours`}
              label={`View hours (${timesheetEntryCount})`}
            />
            {/* Draft-invoice CTAs live on the Invoices tab now (with
                explainers) and on the Approvals sidebar card when there
                are unbilled hours pending — kept Quick actions free of
                that duplication. */}
            <ActionLink
              href={`/expenses/new?projectId=${project.id}`}
              label="Log expense"
            />
            <ActionLink
              href={`/projects/${project.code}/risks`}
              label="Add risk"
            />
            <ActionLink
              href={`/projects/${project.code}/milestones`}
              label="Manage milestones"
            />
            <ActionLink
              href={`/projects/${project.code}/settings`}
              label="Project settings"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integrations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <Row label="SharePoint">
              {project.sharepointFolderUrl ? (
                <a
                  href={project.sharepointFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:underline"
                >
                  Team folder ↗
                </a>
              ) : (
                <span className="text-ink-3">—</span>
              )}
            </Row>
            <Row label="Admin folder">
              {project.sharepointAdminFolderUrl ? (
                <a
                  href={project.sharepointAdminFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:underline"
                >
                  Admin ↗
                </a>
              ) : (
                <span className="text-ink-3">—</span>
              )}
            </Row>
            <Row label="Xero tracking">
              {project.xeroTrackingCategoryValue ? (
                <span className="font-mono text-[11px] text-ink-2">
                  Projects · {project.code}
                </span>
              ) : (
                <span className="text-ink-3">on first push</span>
              )}
            </Row>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function KpiTile({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub: string;
  tone?: 'neutral' | 'green' | 'amber' | 'red';
}) {
  const subColor =
    tone === 'green'
      ? 'text-status-green'
      : tone === 'amber'
        ? 'text-status-amber'
        : tone === 'red'
          ? 'text-status-red'
          : 'text-ink-3';
  return (
    <Card>
      <CardContent className="space-y-1 py-3">
        <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
          {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums text-ink">{value}</div>
        <div className={`text-[11px] ${subColor}`}>{sub}</div>
      </CardContent>
    </Card>
  );
}

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-md border border-line px-2 py-1.5 text-ink-2 hover:bg-surface-hover hover:text-ink"
    >
      <span>{label}</span>
      <span className="text-ink-4">→</span>
    </Link>
  );
}
