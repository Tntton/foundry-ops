import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { prisma } from '@/server/db';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ProvisionSharePointButton } from './provision-button';

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

export default async function ProjectDetailPage({ params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session) notFound();

  const project = await prisma.project.findUnique({
    where: { code: params.code },
    include: {
      client: { select: { id: true, code: true, legalName: true } },
      primaryPartner: { select: { id: true, initials: true, firstName: true, lastName: true } },
      manager: { select: { id: true, initials: true, firstName: true, lastName: true } },
      team: {
        include: {
          person: {
            select: { id: true, initials: true, firstName: true, lastName: true, band: true },
          },
        },
      },
      milestones: { orderBy: { dueDate: 'asc' } },
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

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/projects" className="text-ink-3 hover:text-ink">
          ← Back to Projects
        </Link>
      </div>

      <header className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {project.code}
            </Badge>
            <h1 className="text-xl font-semibold text-ink">{project.name}</h1>
            <Badge variant={STAGE_VARIANT[project.stage] ?? 'outline'}>{project.stage}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink-3">
            Client:{' '}
            <Link href={`/directory/clients/${project.client.id}`} className="hover:underline">
              <span className="font-mono">{project.client.code}</span>{' '}
              <span>{project.client.legalName}</span>
            </Link>
          </p>
        </div>
        <div className="flex items-start gap-4">
          <div className="text-right text-sm">
            <div className="text-ink-3">Contract value</div>
            <div className="text-lg font-semibold tabular-nums text-ink">
              {formatMoney(project.contractValue)}
            </div>
          </div>
          <Link
            href={`/projects/${project.code}/settings`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            Settings
          </Link>
        </div>
      </header>

      <Tabs defaultValue="brief">
        <TabsList>
          <TabsTrigger value="brief">Brief</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
          <TabsTrigger value="pnl">P&amp;L</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="risks">Risks</TabsTrigger>
        </TabsList>

        <TabsContent value="brief">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Dates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Start">{project.startDate.toLocaleDateString('en-AU')}</Row>
                <Row label="End">{project.endDate.toLocaleDateString('en-AU')}</Row>
                <Row label="Actual end">
                  {project.actualEndDate?.toLocaleDateString('en-AU') ?? '—'}
                </Row>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Leadership</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <PersonRow label="Primary partner" p={project.primaryPartner} />
                <PersonRow label="Project manager" p={project.manager} />
              </CardContent>
            </Card>
          </div>
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Integrations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="SharePoint">
                {project.sharepointFolderUrl ? (
                  <a
                    href={project.sharepointFolderUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-brand hover:underline"
                  >
                    Open team folder →
                  </a>
                ) : (
                  <span className="text-ink-3">Not provisioned — see Files tab</span>
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
                    Open admin folder →
                  </a>
                ) : (
                  <span className="text-ink-3">—</span>
                )}
              </Row>
              <Row label="Xero tracking">
                {project.xeroTrackingCategoryValue ? (
                  <span className="font-mono text-xs text-ink-2">
                    Projects · {project.code}
                  </span>
                ) : (
                  <span className="text-ink-3">Not synced — pushes on first invoice/bill</span>
                )}
              </Row>
            </CardContent>
          </Card>
          {project.description && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm text-ink-2">{project.description}</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="team">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Team ({project.team.length})</CardTitle>
              <Link
                href={`/projects/${project.code}/team/edit`}
                className="text-sm text-brand hover:underline"
              >
                Manage →
              </Link>
            </CardHeader>
            <CardContent>
              {project.team.length === 0 ? (
                <p className="text-sm text-ink-3">
                  No team yet.{' '}
                  <Link
                    href={`/projects/${project.code}/team/edit`}
                    className="text-brand hover:underline"
                  >
                    Add members →
                  </Link>
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {project.team.map((t) => (
                    <li key={t.id} className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px]">
                          {t.person.initials}
                        </AvatarFallback>
                      </Avatar>
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

        <TabsContent value="pnl">
          <Card>
            <CardContent className="py-8 text-center text-sm text-ink-3">
              P&amp;L tab lands with TASK-037 (deferred — depends on Xero sync).
            </CardContent>
          </Card>
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
  p: { id: string; initials: string; firstName: string; lastName: string };
}) {
  return (
    <div>
      <div className="text-xs text-ink-3">{label}</div>
      <Link
        href={`/directory/people/${p.id}`}
        className="mt-1 flex items-center gap-2 hover:text-ink"
      >
        <Avatar className="h-7 w-7">
          <AvatarFallback className="text-[10px]">{p.initials}</AvatarFallback>
        </Avatar>
        <span className="font-medium text-ink">
          {p.firstName} {p.lastName}
        </span>
      </Link>
    </div>
  );
}
