import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { getPerson } from '@/server/directory';
import { prisma } from '@/server/db';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import {
  ArchivePersonButton,
  ReactivatePersonButton,
} from './archive/dialog';

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

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/directory" className="text-ink-3 hover:text-ink">
          ← Back to Directory
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14">
            <AvatarFallback className="text-base">{person.initials}</AvatarFallback>
          </Avatar>
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
                <Badge variant="green">Active</Badge>
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
            </div>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
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
          </div>
        )}
      </div>

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

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="pay">Pay</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
              <CardDescription>Reachable at</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Field label="Email">
                <span className="font-mono">{person.email}</span>
              </Field>
              <Field label="Phone">{person.phone ?? '—'}</Field>
              <Field label="WhatsApp">{person.whatsappNumber ?? '—'}</Field>
              <Field label="Region">{person.region}</Field>
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
              <Field label="FTE">{formatFte(person.fte)}</Field>
              <Field label="Start date">{person.startDate.toLocaleDateString('en-AU')}</Field>
              <Field label="End date">
                {person.endDate ? person.endDate.toLocaleDateString('en-AU') : '—'}
              </Field>
            </CardContent>
          </Card>
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
                  <Field label="Rate">{formatRateCents(person.rate, person.rateUnit)}</Field>
                  <Field label="Unit">{person.rateUnit === 'hour' ? 'Hourly' : 'Daily'}</Field>
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
