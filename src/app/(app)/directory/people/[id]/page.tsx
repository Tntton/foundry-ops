import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { getPerson } from '@/server/directory';
import { prisma } from '@/server/db';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HeadshotEditButton } from '@/components/headshot-edit-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatFte, formatRateCents } from '@/lib/format';
import { countryName } from '@/lib/countries';
import {
  listPersonTimesheetEntries,
  listContractorBillableEntries,
} from '@/server/timesheet';
import {
  ArchivePersonButton,
  ReactivatePersonButton,
} from './archive/dialog';
import { InactiveToggleButton } from './inactive/inactive-toggle';
import { InlineField } from './inline-field';
import { CvUploadPanel } from './cv/cv-upload-panel';
import { EducationWorkPanel } from './cv/education-work-panel';
import { MagicLinkButton } from './magic-link/button';

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const STAGE_VARIANT: Record<string, 'amber' | 'green' | 'blue' | 'outline'> = {
  kickoff: 'amber',
  delivery: 'green',
  closing: 'blue',
  archived: 'outline',
};
const BILL_STATUS_VARIANT: Record<string, 'outline' | 'amber' | 'green' | 'blue' | 'red'> = {
  pending_review: 'amber',
  approved: 'blue',
  rejected: 'red',
  scheduled_for_payment: 'blue',
  paid: 'green',
};

export default async function PersonDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tempPassword?: string };
}) {
  const session = await getSession();
  if (!session) notFound();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) {
    notFound();
  }

  const person = await getPerson(params.id);
  if (!person) notFound();

  const canSeePay = hasCapability(session, 'ratecard.view');
  const canEdit = hasCapability(session, 'person.edit');
  // Inline-editable fields are looser — anyone can update their OWN
  // contact info (phone / WhatsApp / LinkedIn / mailing / emergency
  // contact). Admins / partners can edit anyone's. Privileged fields
  // (band, level, employment, fte, region, roles) still route through
  // the deliberate full-form edit page.
  const canInlineEdit = canEdit || params.id === session.person.id;
  const canDelete = hasCapability(session, 'person.delete');
  const tempPassword = searchParams.tempPassword;

  const [
    tsMine,
    tsApproved,
    expMine,
    expApproved,
    teamCount,
    clientsLed,
    projectsOwned,
    dealsOwned,
    approvalsTouched,
    auditCount,
  ] = canDelete
    ? await Promise.all([
        prisma.timesheetEntry.count({ where: { personId: person.id } }),
        prisma.timesheetEntry.count({ where: { approvedById: person.id } }),
        prisma.expense.count({ where: { personId: person.id } }),
        prisma.expense.count({ where: { approvedById: person.id } }),
        prisma.projectTeam.count({ where: { personId: person.id } }),
        prisma.client.count({ where: { primaryPartnerId: person.id } }),
        prisma.project.count({
          where: { OR: [{ primaryPartnerId: person.id }, { managerId: person.id }] },
        }),
        prisma.deal.count({ where: { ownerId: person.id } }),
        prisma.approval.count({
          where: { OR: [{ requestedById: person.id }, { decidedById: person.id }] },
        }),
        prisma.auditEvent.count({ where: { actorId: person.id } }),
      ])
    : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const deleteBlockers: string[] = [];
  if (tsMine || tsApproved) {
    const n = tsMine + tsApproved;
    deleteBlockers.push(`${n} timesheet ${n === 1 ? 'entry' : 'entries'}`);
  }
  if (expMine || expApproved) {
    const n = expMine + expApproved;
    deleteBlockers.push(`${n} expense${n === 1 ? '' : 's'}`);
  }
  if (teamCount) deleteBlockers.push(`${teamCount} team membership${teamCount === 1 ? '' : 's'}`);
  if (clientsLed) deleteBlockers.push(`${clientsLed} client${clientsLed === 1 ? '' : 's'} (primary partner)`);
  if (projectsOwned) deleteBlockers.push(`${projectsOwned} project${projectsOwned === 1 ? '' : 's'} (owner)`);
  if (dealsOwned) deleteBlockers.push(`${dealsOwned} deal${dealsOwned === 1 ? '' : 's'}`);
  if (approvalsTouched) deleteBlockers.push(`${approvalsTouched} approval${approvalsTouched === 1 ? '' : 's'}`);
  if (auditCount) deleteBlockers.push(`${auditCount} audit event${auditCount === 1 ? '' : 's'}`);

  // Activity — hours by project + bills + clients/projects they own.
  const [tsByProject, teamMemberships, recentBills, ownedClients, ownedProjects] =
    await Promise.all([
      prisma.timesheetEntry.groupBy({
        by: ['projectId'],
        where: { personId: person.id, status: { in: ['approved', 'billed'] } },
        _sum: { hours: true },
      }),
      prisma.projectTeam.findMany({
        where: { personId: person.id },
        select: {
          project: { select: { id: true, code: true, name: true, stage: true } },
          allocationPct: true,
          roleOnProject: true,
        },
      }),
      person.employment === 'contractor'
        ? prisma.bill.findMany({
            where: { supplierPersonId: person.id },
            orderBy: { issueDate: 'desc' },
            take: 10,
            select: {
              id: true,
              supplierInvoiceNumber: true,
              issueDate: true,
              dueDate: true,
              amountTotal: true,
              category: true,
              status: true,
              project: { select: { code: true } },
            },
          })
        : Promise.resolve([]),
      prisma.client.findMany({
        where: { primaryPartnerId: person.id },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, legalName: true },
      }),
      prisma.project.findMany({
        where: {
          OR: [{ primaryPartnerId: person.id }, { managerId: person.id }],
        },
        orderBy: { code: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          stage: true,
          primaryPartnerId: true,
          managerId: true,
        },
      }),
    ]);

  const projectIds = new Set<string>([
    ...tsByProject.map((t) => t.projectId),
    ...teamMemberships.map((m) => m.project.id),
  ]);
  const projectMeta =
    projectIds.size > 0
      ? await prisma.project.findMany({
          where: { id: { in: [...projectIds] } },
          select: { id: true, code: true, name: true, stage: true },
        })
      : [];
  const projectById = new Map(projectMeta.map((p) => [p.id, p]));

  type ProjectActivityRow = {
    id: string;
    code: string;
    name: string;
    stage: string;
    hours: number;
    allocationPct: number | null;
    roleOnProject: string | null;
  };
  const projectActivity = new Map<string, ProjectActivityRow>();
  for (const t of tsByProject) {
    const p = projectById.get(t.projectId);
    if (!p) continue;
    projectActivity.set(p.id, {
      id: p.id,
      code: p.code,
      name: p.name,
      stage: p.stage,
      hours: Number(t._sum.hours ?? 0),
      allocationPct: null,
      roleOnProject: null,
    });
  }
  for (const m of teamMemberships) {
    const existing = projectActivity.get(m.project.id);
    if (existing) {
      existing.allocationPct = m.allocationPct;
      existing.roleOnProject = m.roleOnProject;
    } else {
      projectActivity.set(m.project.id, {
        id: m.project.id,
        code: m.project.code,
        name: m.project.name,
        stage: m.project.stage,
        hours: 0,
        allocationPct: m.allocationPct,
        roleOnProject: m.roleOnProject,
      });
    }
  }
  const projectActivityRows = [...projectActivity.values()].sort((a, b) =>
    a.code.localeCompare(b.code),
  );

  const totalHours = projectActivityRows.reduce((s, r) => s + r.hours, 0);
  const totalBillsPaidCents = recentBills
    .filter((b) => ['approved', 'scheduled_for_payment', 'paid'].includes(b.status))
    .reduce((s, b) => s + b.amountTotal, 0);
  const billsCountAll = await (person.employment === 'contractor'
    ? prisma.bill.count({ where: { supplierPersonId: person.id } })
    : Promise.resolve(0));

  // Time tab: recent entries (last 12 weeks) + contractor billable summary.
  const timeFromDate = new Date();
  timeFromDate.setUTCDate(timeFromDate.getUTCDate() - 12 * 7);
  const recentTimesheetEntries = await listPersonTimesheetEntries(person.id, {
    from: timeFromDate,
  });
  const contractorBillable =
    person.employment === 'contractor'
      ? await listContractorBillableEntries(person.id)
      : null;

  // CV-derived entries — sequential to keep the connection pool tame.
  const cvEducation = await prisma.educationEntry.findMany({
    where: { personId: person.id },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      institution: true,
      degree: true,
      field: true,
      startYear: true,
      endYear: true,
      notes: true,
    },
  });
  const cvWork = await prisma.workHistoryEntry.findMany({
    where: { personId: person.id },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      company: true,
      title: true,
      location: true,
      startYear: true,
      endYear: true,
      current: true,
      description: true,
    },
  });

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/directory" className="text-ink-3 hover:text-ink">
          ← Back to Directory
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          {person.headshotUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={person.headshotUrl}
              alt={`${person.firstName} ${person.lastName}`}
              className="h-14 w-14 rounded-full border border-line object-cover"
            />
          ) : (
            <PersonAvatar
  className="h-14 w-14"
  fallbackClassName="text-base"
  initials={person.initials}
  headshotUrl={person.headshotUrl}
/>
          )}
          <div>
            <h1 className="text-xl font-semibold text-ink">
              {person.firstName} {person.lastName}
            </h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-ink-3">
              <span>{person.band}</span>
              <span>·</span>
              <span>{person.level}</span>
              <span>·</span>
              <span className="font-mono">{person.email}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              {person.active ? (
                person.inactive ? (
                  <Badge variant="amber">Inactive</Badge>
                ) : (
                  <Badge variant="green">Active</Badge>
                )
              ) : (
                <Badge variant="outline">Ended</Badge>
              )}
              <Badge variant={person.employment === 'ft' ? 'green' : 'blue'}>
                {person.employment === 'ft' ? 'Full-time' : 'Contractor'}
              </Badge>
              {person.roles.map((r) => (
                <Badge key={r} variant="secondary">
                  {r.replace('_', ' ')}
                </Badge>
              ))}
              {person.poolStatusOverride && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2 py-0.5 text-[10px] text-ink-2"
                  title="Pool status manually set by a super admin"
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      person.poolStatusOverride === 'on_project'
                        ? 'bg-status-green'
                        : person.poolStatusOverride === 'never_on_project'
                          ? 'bg-status-red'
                          : person.poolStatusOverride === 'on_sabbatical'
                            ? 'bg-ink-4'
                            : 'bg-ink-3'
                    }`}
                  />
                  {person.poolStatusOverride
                    .replace(/_/g, ' ')
                    .replace(/^./, (c) => c.toUpperCase())}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Inactive toggle is available even when canEdit=false, since
               anyone can pause their own profile. */}
          {person.active &&
            (canEdit || person.id === session.person.id) && (
              <InactiveToggleButton
                personId={person.id}
                isInactive={person.inactive}
                isSelf={person.id === session.person.id}
                personFirstName={person.firstName}
              />
            )}
          {canEdit && (
            <>
              {hasAnyRole(session, ['super_admin']) &&
                person.id !== session.person.id && (
                  <Button asChild variant="outline">
                    <Link href={`/timesheet?personId=${person.id}`}>
                      View timesheet
                    </Link>
                  </Button>
                )}
              <Button asChild variant="outline">
                <Link href={`/directory/people/${person.id}/edit`}>Edit</Link>
              </Button>
              {person.active ? (
                <ArchivePersonButton
                  personId={person.id}
                  personEmail={person.email}
                  personName={`${person.firstName} ${person.lastName}`}
                  isSelf={person.id === session.person.id}
                  canDelete={canDelete && person.id !== session.person.id}
                  deleteBlockers={deleteBlockers}
                />
              ) : (
                <ReactivatePersonButton personId={person.id} />
              )}
            </>
          )}
        </div>
      </div>

      {person.active && person.inactive && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft/40 px-4 py-3 text-sm text-status-amber">
          <strong>Profile inactive</strong> · all input surfaces
          (timesheet, availability, expenses) are disabled until the
          profile is reactivated. Visible in the directory and the
          resource-planning pool.
        </div>
      )}

      {tempPassword && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-4 py-3 text-sm text-status-amber">
          <strong>Temporary M365 password — shown once:</strong>{' '}
          <span className="font-mono">{tempPassword}</span>
          <div className="mt-1 text-xs text-ink-2">
            Copy and share with the new user via a secure channel. They&apos;ll be required
            to change it on first sign-in. This message will not reappear — refresh and
            it&apos;s gone.
          </div>
        </div>
      )}

      {/* Super-admin escape hatch — issue a magic sign-in link for this
          person. Emails via Resend + surfaces the URL for copy/paste so
          it works even when email is down. Every issuance is audited. */}
      {hasAnyRole(session, ['super_admin']) && (
        <div className="rounded-md border border-line bg-card px-4 py-3">
          <div className="text-sm font-medium text-ink">Sign-in link</div>
          <p className="mb-2 text-xs text-ink-3">
            Issue a single-use magic link (15-minute TTL) for{' '}
            <span className="font-mono">{person.email}</span>. Also emailed. Use when Entra sign-in is unavailable or for contractor onboarding.
          </p>
          <MagicLinkButton personId={person.id} personEmail={person.email} />
        </div>
      )}

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="cv">CV</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="time">Time</TabsTrigger>
          <TabsTrigger value="pay">Pay</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          {hasAnyRole(session, ['super_admin', 'admin']) && (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>Headshot</CardTitle>
                <CardDescription>
                  Set / replace this person&apos;s headshot. Crop into a
                  circular frame, drag to position, slide to zoom.
                  Saves at 512×512 JPEG.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <HeadshotEditButton
                  currentUrl={person.headshotUrl}
                  targetPersonId={person.id}
                  label="Replace headshot"
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
              <CardDescription>
                Click any value to edit inline. Country / band / level
                still flow through the deliberate edit form.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Field label="Email">
                <span className="font-mono">{person.email}</span>
              </Field>
              <Field label="Phone">
                <InlineField
                  personId={person.id}
                  field="phone"
                  type="tel"
                  initialValue={person.phone}
                  canEdit={canInlineEdit}
                  placeholder="+61 4xx xxx xxx"
                />
              </Field>
              <Field label="WhatsApp">
                <InlineField
                  personId={person.id}
                  field="whatsappNumber"
                  type="tel"
                  initialValue={person.whatsappNumber}
                  canEdit={canInlineEdit}
                  placeholder="+61 4xx xxx xxx"
                />
              </Field>
              <Field label="LinkedIn">
                <InlineField
                  personId={person.id}
                  field="linkedinUrl"
                  type="url"
                  initialValue={person.linkedinUrl}
                  canEdit={canInlineEdit}
                  placeholder="linkedin.com/in/username"
                />
              </Field>
              <Field label="Country">
                <span className="font-mono">{person.region}</span>
                <span className="ml-2 text-ink-3">{countryName(person.region)}</span>
              </Field>
              <Field label="Mailing address">
                <InlineField
                  personId={person.id}
                  field="mailingAddress"
                  initialValue={person.mailingAddress}
                  canEdit={canInlineEdit}
                  multiline
                  placeholder="Street, suburb, state postcode"
                />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employment">
          <Card>
            <CardHeader>
              <CardTitle>Employment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Field label="Band">{person.band}</Field>
              <Field label="Level">{person.level}</Field>
              <Field label="Employment type">
                {person.employment === 'ft' ? 'Full-time' : 'Contractor'}
              </Field>
              <Field label="FTE">
                {person.fte !== null ? formatFte(person.fte) : '—'}
              </Field>
              <Field label="Start date">{person.startDate.toLocaleDateString('en-AU')}</Field>
              <Field label="End date">
                {person.endDate ? person.endDate.toLocaleDateString('en-AU') : '—'}
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cv">
          <div className="space-y-4">
            <CvUploadPanel
              personId={person.id}
              canEdit={canInlineEdit}
            />
            <EducationWorkPanel
              education={cvEducation}
              work={cvWork}
            />
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <TotalCard
                label="Hours logged"
                value={totalHours.toFixed(1)}
                sub="approved + billed"
              />
              <TotalCard
                label="Projects"
                value={String(projectActivityRows.length)}
                sub={`${projectActivityRows.filter((p) => p.stage !== 'archived').length} active`}
              />
              {person.employment === 'contractor' ? (
                <>
                  <TotalCard
                    label="Bills issued"
                    value={String(billsCountAll)}
                    sub={`${formatMoney(totalBillsPaidCents)} approved+`}
                  />
                  <TotalCard
                    label="Clients led"
                    value={String(ownedClients.length)}
                    sub="as primary partner"
                  />
                </>
              ) : (
                <>
                  <TotalCard
                    label="Clients led"
                    value={String(ownedClients.length)}
                    sub="as primary partner"
                  />
                  <TotalCard
                    label="Projects owned"
                    value={String(ownedProjects.length)}
                    sub="partner or manager"
                  />
                </>
              )}
            </div>

            <Card className="p-0">
              <CardHeader>
                <CardTitle>Project engagement</CardTitle>
                <CardDescription>
                  Approved + billed hours plus any project-team memberships.
                </CardDescription>
              </CardHeader>
              {projectActivityRows.length === 0 ? (
                <CardContent>
                  <p className="text-sm text-ink-3">
                    No timesheet activity or project team memberships yet.
                  </p>
                </CardContent>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead className="text-right">Allocation</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projectActivityRows.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <Link
                            href={`/projects/${p.code}`}
                            className="flex items-center gap-2 hover:underline"
                          >
                            <span className="font-mono text-xs text-ink-3">{p.code}</span>
                            <span className="text-sm text-ink">{p.name}</span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={STAGE_VARIANT[p.stage] ?? 'outline'}
                            className="capitalize"
                          >
                            {p.stage}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-ink-2">
                          {p.roleOnProject ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs text-ink-3">
                          {p.allocationPct !== null ? `${p.allocationPct}%` : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-ink-2">
                          {p.hours > 0 ? p.hours.toFixed(1) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>

            {person.employment === 'contractor' && (
              <Card className="p-0">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Bills issued by this contractor</CardTitle>
                    <CardDescription>
                      Supplier-side bills where they are the paid party.
                    </CardDescription>
                  </div>
                  {billsCountAll > 10 && (
                    <span className="pr-4 text-xs text-ink-3">
                      Showing 10 of {billsCountAll}
                    </span>
                  )}
                </CardHeader>
                {recentBills.length === 0 ? (
                  <CardContent>
                    <p className="text-sm text-ink-3">No bills issued yet.</p>
                  </CardContent>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Issued</TableHead>
                        <TableHead>Ref</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Due</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentBills.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="tabular-nums text-xs">
                            {b.issueDate.toLocaleDateString('en-AU')}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            <Link href={`/bills/${b.id}`} className="hover:underline">
                              {b.supplierInvoiceNumber ?? 'open →'}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="capitalize">
                              {b.category.replace(/_/g, ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-ink-3">
                            {b.project ? (
                              <Link
                                href={`/projects/${b.project.code}`}
                                className="font-mono hover:underline"
                              >
                                {b.project.code}
                              </Link>
                            ) : (
                              <span className="text-ink-4">OPEX</span>
                            )}
                          </TableCell>
                          <TableCell className="tabular-nums text-xs">
                            {b.dueDate.toLocaleDateString('en-AU')}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-ink">
                            {formatMoney(b.amountTotal)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={BILL_STATUS_VARIANT[b.status] ?? 'outline'}
                              className="capitalize"
                            >
                              {b.status.replace(/_/g, ' ')}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Card>
            )}

            {(ownedClients.length > 0 || ownedProjects.length > 0) && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {ownedClients.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Clients led ({ownedClients.length})</CardTitle>
                      <CardDescription>As primary partner.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1 text-sm">
                        {ownedClients.map((c) => (
                          <li key={c.id} className="flex items-center gap-2">
                            <Link
                              href={`/directory/clients/${c.id}`}
                              className="flex items-center gap-2 hover:underline"
                            >
                              <Badge variant="outline" className="font-mono">
                                {c.code}
                              </Badge>
                              <span className="text-ink">{c.legalName}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
                {ownedProjects.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Projects owned ({ownedProjects.length})</CardTitle>
                      <CardDescription>As primary partner or manager.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1 text-sm">
                        {ownedProjects.map((p) => (
                          <li key={p.id} className="flex items-center gap-2">
                            <Link
                              href={`/projects/${p.code}`}
                              className="flex items-center gap-2 hover:underline"
                            >
                              <Badge variant="outline" className="font-mono">
                                {p.code}
                              </Badge>
                              <span className="text-ink">{p.name}</span>
                              <Badge
                                variant={STAGE_VARIANT[p.stage] ?? 'outline'}
                                className="capitalize"
                              >
                                {p.stage}
                              </Badge>
                              <span className="text-xs text-ink-3">
                                {p.primaryPartnerId === person.id
                                  ? p.managerId === person.id
                                    ? 'partner + manager'
                                    : 'partner'
                                  : 'manager'}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="time">
          <PersonTimePanel
            personId={person.id}
            employment={person.employment}
            entries={recentTimesheetEntries}
            contractorBillable={contractorBillable}
            canSeePay={canSeePay}
          />
        </TabsContent>

        <TabsContent value="pay">
          {canSeePay ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Pay</CardTitle>
                  <CardDescription>
                    Visible to Super Admin / Admin / Partner only.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Field label="Rate">
                    {formatRateCents(person.rate, person.rateUnit)}
                    {person.rateOverride && (
                      <span className="ml-2 rounded-sm bg-status-amber-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-amber">
                        Manual override
                      </span>
                    )}
                  </Field>
                  <Field label="Unit">{person.rateUnit === 'hour' ? 'Hourly' : 'Daily'}</Field>
                  {person.expertRate !== null && person.expertRate > 0 && person.expertRateUnit && (
                    <Field label="Expert rate">
                      {formatRateCents(person.expertRate, person.expertRateUnit)}
                      <span className="ml-2 text-[11px] text-ink-3">
                        (applied when engaged in expert / fellow capacity)
                      </span>
                    </Field>
                  )}
                  {person.agencyName && (
                    <>
                      <Field label="Agency">
                        <span>{person.agencyName}</span>
                        {person.agencyMarkupPct !== null && person.agencyMarkupPct > 0 && (
                          <span className="ml-2 text-[11px] text-ink-3">
                            +{person.agencyMarkupPct}% markup · fully-loaded ≈{' '}
                            <span className="font-mono text-ink-2">
                              {formatRateCents(
                                Math.round(person.rate * (1 + person.agencyMarkupPct / 100)),
                                person.rateUnit,
                              )}
                            </span>
                          </span>
                        )}
                      </Field>
                    </>
                  )}
                </CardContent>
              </Card>
              {canEdit && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-2">
                    <div>
                      <CardTitle>Bank details</CardTitle>
                      <CardDescription>
                        Encrypted. Required before this person can be included on a
                        contractor pay-run.
                      </CardDescription>
                    </div>
                    <Link
                      href={`/directory/people/${person.id}/bank`}
                      className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
                    >
                      {person.bankBsb || person.bankAcc ? 'Update' : 'Add'}
                    </Link>
                  </CardHeader>
                  <CardContent className="text-sm text-ink-3">
                    {person.bankBsb && person.bankAcc ? (
                      <span>BSB + account on file. Values are masked — click Update to change.</span>
                    ) : person.bankBsb || person.bankAcc ? (
                      <span className="text-status-amber">
                        Partial — only one of BSB / account is set. Pay-runs will reject this person until both are in.
                      </span>
                    ) : (
                      <span>Not set.</span>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-ink-3">
                You don&apos;t have permission to view pay details.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="integrations">
          <Card>
            <CardHeader>
              <CardTitle>External identities</CardTitle>
              <CardDescription>Links to Microsoft 365 and Xero.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Field label="M365 user ID">
                {person.entraUserId ? (
                  <span className="font-mono text-xs">{person.entraUserId}</span>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </Field>
              <Field label="Xero contact ID">
                {person.xeroContactId ? (
                  <span className="font-mono text-xs">{person.xeroContactId}</span>
                ) : (
                  <span className="text-ink-3">
                    {person.employment === 'contractor'
                      ? 'Not linked — contractor syncs on first bill push'
                      : 'Only contractors sync to Xero'}
                  </span>
                )}
              </Field>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1">
      <div className="text-ink-3">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}

function TotalCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
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

const TIME_STATUS_VARIANT: Record<
  'draft' | 'submitted' | 'approved' | 'billed',
  'outline' | 'amber' | 'green' | 'blue'
> = {
  draft: 'outline',
  submitted: 'amber',
  approved: 'green',
  billed: 'blue',
};

function PersonTimePanel({
  personId,
  employment,
  entries,
  contractorBillable,
  canSeePay,
}: {
  personId: string;
  employment: 'ft' | 'contractor';
  entries: Awaited<ReturnType<typeof listPersonTimesheetEntries>>;
  contractorBillable: Awaited<ReturnType<typeof listContractorBillableEntries>> | null;
  canSeePay: boolean;
}) {
  const totals = { draft: 0, submitted: 0, approved: 0, billed: 0 };
  for (const e of entries) totals[e.status] += e.hours;

  // Bucket by week → project for the recent grid.
  type WeekRoll = {
    weekStart: Date;
    byProject: Map<string, { code: string; name: string; hours: number }>;
    total: number;
  };
  const byWeek = new Map<string, WeekRoll>();
  for (const e of entries) {
    const ws = startOfWeekUTC(e.date);
    const key = ws.toISOString();
    const cur =
      byWeek.get(key) ??
      ({ weekStart: ws, byProject: new Map(), total: 0 } satisfies WeekRoll);
    const proj =
      cur.byProject.get(e.project.id) ??
      ({ code: e.project.code, name: e.project.name, hours: 0 } as {
        code: string;
        name: string;
        hours: number;
      });
    proj.hours += e.hours;
    cur.byProject.set(e.project.id, proj);
    cur.total += e.hours;
    byWeek.set(key, cur);
  }
  const sortedWeeks = Array.from(byWeek.values()).sort(
    (a, b) => b.weekStart.getTime() - a.weekStart.getTime(),
  );

  const billableTotalHours =
    contractorBillable?.groups.reduce((s, g) => s + g.hours, 0) ?? 0;
  const billableTotalCents =
    contractorBillable?.groups.reduce((s, g) => s + g.billCents, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <TotalCard label="Draft" value={`${totals.draft.toFixed(1)}h`} sub="last 12 weeks" />
        <TotalCard
          label="Submitted"
          value={`${totals.submitted.toFixed(1)}h`}
          sub="awaiting approval"
        />
        <TotalCard
          label="Approved"
          value={`${totals.approved.toFixed(1)}h`}
          sub="in P&L"
        />
        <TotalCard
          label="Billed"
          value={`${totals.billed.toFixed(1)}h`}
          sub="linked to invoice/bill"
        />
      </div>

      {employment === 'contractor' && contractorBillable && (
        <Card>
          <CardHeader>
            <CardTitle>Approved &amp; unbilled</CardTitle>
            <CardDescription>
              Approved contractor hours not yet attached to a bill. Generate a draft
              bill below — the entries get marked &ldquo;billed&rdquo; once you save.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {contractorBillable.groups.length === 0 ? (
              <p className="py-4 text-center text-sm text-ink-3">
                Nothing approved + unbilled right now.
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      {canSeePay && (
                        <>
                          <TableHead className="text-right">Cost</TableHead>
                          <TableHead className="text-right">
                            Bill amount{' '}
                            {contractorBillable.billRate ? '(at billRate)' : '(at cost rate)'}
                          </TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contractorBillable.groups.map((g) => (
                      <TableRow key={g.projectId}>
                        <TableCell>
                          <Link
                            href={`/projects/${g.projectCode}`}
                            className="hover:underline"
                          >
                            <span className="font-mono text-xs text-ink-3">
                              {g.projectCode}
                            </span>{' '}
                            <span className="text-ink-2">{g.projectName}</span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {g.hours.toFixed(2)}
                        </TableCell>
                        {canSeePay && (
                          <>
                            <TableCell className="text-right tabular-nums text-ink-3">
                              {formatMoney(g.costCents)}
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {formatMoney(g.billCents)}
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                  <div className="text-sm text-ink-3">
                    <span className="text-ink">{billableTotalHours.toFixed(1)}h</span>{' '}
                    across {contractorBillable.groups.length}{' '}
                    {contractorBillable.groups.length === 1 ? 'project' : 'projects'}
                    {canSeePay && (
                      <>
                        {' '}·{' '}
                        <span className="font-semibold text-ink">
                          {formatMoney(billableTotalCents)}
                        </span>{' '}
                        ready to bill
                      </>
                    )}
                  </div>
                  <Link
                    href={`/directory/people/${personId}/draft-bill`}
                    className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-sm font-medium text-brand-ink hover:opacity-90"
                  >
                    Draft bill from these hours →
                  </Link>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="p-0">
        <CardHeader>
          <CardTitle>Last 12 weeks · by week + project</CardTitle>
          <CardDescription>
            Newest first. Project links jump to the project hours tab. Hover/CSV for
            descriptions.
          </CardDescription>
        </CardHeader>
        {sortedWeeks.length === 0 ? (
          <CardContent>
            <p className="py-4 text-center text-sm text-ink-3">
              No timesheet entries in the last 12 weeks.
            </p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week of</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedWeeks.map((w) =>
                Array.from(w.byProject.values()).map((p, idx) => (
                  <TableRow key={`${w.weekStart.toISOString()}|${p.code}`}>
                    <TableCell className="text-xs tabular-nums text-ink-3">
                      {idx === 0
                        ? w.weekStart.toLocaleDateString('en-AU', {
                            day: 'numeric',
                            month: 'short',
                          })
                        : ''}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/projects/${p.code}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {p.code}
                      </Link>
                      <span className="ml-2 text-xs text-ink-3">{p.name}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.hours.toFixed(2)}
                    </TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent entries</CardTitle>
          <CardDescription>Newest 50 — full data via CSV.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.slice(0, 50).map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs tabular-nums text-ink-3">
                    {e.date.toLocaleDateString('en-AU')}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/projects/${e.project.code}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {e.project.code}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {e.hours.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-xs text-ink-3">
                    {e.description ?? <span className="text-ink-4">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={TIME_STATUS_VARIANT[e.status]} className="text-[10px]">
                      {e.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="border-t border-line p-3 text-right">
            <Link
              href={`/api/reports/timesheet?personId=${personId}`}
              className="text-xs text-brand hover:underline"
            >
              Download CSV →
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function startOfWeekUTC(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}
