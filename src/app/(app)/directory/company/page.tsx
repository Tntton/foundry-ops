import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CompanyLogo } from '@/components/company-logo';

/**
 * Company tab — Foundry Health's own particulars. Sits next to
 * Suppliers in the directory tabs. The FHP internal client (FH Projects)
 * backs internal FHP* projects, so this is where its identity, registered
 * address, billing details, payment terms, and ABN live in one place.
 * Filtered out of the regular /directory/clients list so it doesn't sit
 * alongside paying clients. FHO (Operations) and FHX (BD / Other) are
 * also internal clients backing the firm-overhead expense buckets but
 * are accounting-only — they don't surface here.
 */
export default async function CompanyDirectoryPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const fh = await prisma.client.findUnique({
    where: { code: 'FHP' },
    include: {
      primaryPartner: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          initials: true,
          headshotUrl: true,
        },
      },
      projects: {
        where: { code: { startsWith: 'FHP' } },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, name: true, stage: true },
      },
    },
  });
  const canEdit = hasCapability(session, 'client.edit');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Directory</h1>
        <p className="text-sm text-ink-3">
          Foundry Health firm details — the legal entity, billing, and
          internal projects (FHP series).
        </p>
      </header>

      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger value="people" asChild>
            <Link href="/directory">People</Link>
          </TabsTrigger>
          <TabsTrigger value="clients" asChild>
            <Link href="/directory/clients">Clients</Link>
          </TabsTrigger>
          <TabsTrigger value="contractors" asChild>
            <Link href="/directory/contractors">Contractors</Link>
          </TabsTrigger>
          <TabsTrigger value="suppliers" asChild>
            <Link href="/directory/suppliers">Suppliers</Link>
          </TabsTrigger>
          <TabsTrigger value="company" asChild>
            <Link href="/directory/company">Company</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {!fh ? (
        <Card>
          <CardContent className="space-y-2 py-8 text-center text-sm text-ink-3">
            <p>The FHP internal client record hasn&apos;t been created yet.</p>
            <p className="text-xs">
              Insert a Client row with <code className="font-mono">code = &lsquo;FHP&rsquo;</code>{' '}
              (FH Projects) — it backs every internal FHP project.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <CompanyLogo
                  src={fh.logoUrl}
                  name={fh.legalName}
                  className="h-14 w-14"
                />
                <div>
                  <CardTitle className="text-base">{fh.legalName}</CardTitle>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                    <Badge variant="outline" className="font-mono">
                      {fh.code}
                    </Badge>
                    <span className="capitalize">
                      {fh.clientType.replace(/_/g, ' ')}
                    </span>
                    {fh.website && (
                      <a
                        href={fh.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand hover:underline"
                      >
                        {fh.website.replace(/^https?:\/\//, '')} ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>
              {canEdit && (
                <Button asChild size="sm" variant="outline">
                  <Link href={`/directory/clients/${fh.id}/edit`}>Edit details</Link>
                </Button>
              )}
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <ParticularSection title="Identity">
                <Particular
                  label="Trading name"
                  value={fh.tradingName ?? '—'}
                />
                <Particular label="ABN" value={fh.abn ?? '—'} mono />
                <Particular label="ACN" value={fh.acn ?? '—'} mono />
                <Particular
                  label="Entity type"
                  value={fh.clientType.replace(/_/g, ' ')}
                  className="capitalize"
                />
              </ParticularSection>
              <ParticularSection title="Registered address">
                <Particular label="Street" value={fh.streetAddress ?? '—'} />
                <Particular label="Suburb" value={fh.suburb ?? '—'} />
                <Particular
                  label="State / Postcode"
                  value={
                    fh.state || fh.postcode
                      ? `${fh.state ?? ''} ${fh.postcode ?? ''}`.trim()
                      : '—'
                  }
                />
                <Particular label="Country" value={fh.country} mono />
              </ParticularSection>
              <ParticularSection title="Primary contact">
                <Particular label="Name" value={fh.contactName ?? '—'} />
                <Particular label="Title" value={fh.contactTitle ?? '—'} />
                <Particular label="Email" value={fh.contactEmail ?? '—'} mono />
                <Particular label="Phone" value={fh.contactPhone ?? '—'} mono />
              </ParticularSection>
              <ParticularSection title="Billing">
                <Particular label="Email" value={fh.billingEmail ?? '—'} mono />
                <Particular
                  label="Payment terms"
                  value={fh.paymentTerms.replace(/-/g, ' ')}
                />
                <Particular
                  label="PO required?"
                  value={fh.purchaseOrderRequired ? 'Yes' : 'No'}
                />
                <Particular
                  label="Xero contact"
                  value={fh.xeroContactId ? `${fh.xeroContactId.slice(0, 8)}…` : '—'}
                  mono
                />
              </ParticularSection>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
                Internal projects · FHP series
                <span className="ml-2 tabular-nums text-ink-3">
                  {fh.projects.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {fh.projects.length === 0 ? (
                <p className="text-sm text-ink-3">
                  No internal projects yet. Create one via{' '}
                  <Link
                    href="/projects/new?kind=internal"
                    className="text-brand hover:underline"
                  >
                    + New project (Internal)
                  </Link>
                  .
                </p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {fh.projects.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between py-2"
                    >
                      <Link
                        href={`/projects/${p.code}`}
                        className="flex items-center gap-2 hover:underline"
                      >
                        <span className="font-mono text-xs text-ink-3">
                          {p.code}
                        </span>
                        <span className="font-medium text-ink">{p.name}</span>
                      </Link>
                      <Badge variant="outline" className="capitalize">
                        {p.stage.replace(/_/g, ' ')}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ParticularSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        {title}
      </h2>
      <dl className="space-y-1 text-sm">{children}</dl>
    </section>
  );
}

function Particular({
  label,
  value,
  mono,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-3">{label}</dt>
      <dd
        className={`text-right text-ink-2 ${mono ? 'font-mono text-xs' : ''} ${
          className ?? ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
