import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { getPerson } from '@/server/directory';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatFte, formatRateCents } from '@/lib/format';

export default async function PersonDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tempPassword?: string };
}) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) {
    notFound();
  }

  const person = await getPerson(params.id);
  if (!person) notFound();

  const canSeePay = hasCapability(session, 'ratecard.view');
  const canEdit = hasCapability(session, 'person.edit');
  const tempPassword = searchParams.tempPassword;

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
          <Button asChild variant="outline">
            <Link href={`/directory/people/${person.id}/edit`}>Edit</Link>
          </Button>
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

        <TabsContent value="pay">
          {canSeePay ? (
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
                      ? 'Not linked (will sync with TASK-051)'
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
