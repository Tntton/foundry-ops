import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { getRecruit, TARGET_BAND_LABELS } from '@/server/recruits';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  MoveBandStrip,
  NixToggleButton,
  PromoteToPersonButton,
} from './detail-actions';
import { InlineRecruitField } from './inline-field';

/**
 * Recruit detail page — full profile + move/nix/promote actions.
 *
 * Three action surfaces:
 *   - Move band: shift the card to a different pool column.
 *   - Nix / restore: flip status to 'nixed' (or back to 'active').
 *   - Promote to Person: hand off to /directory/people/new pre-filled
 *     with the prospect's details. The new-person flow links back
 *     to the recruit row + flips status='converted' on completion.
 */
export default async function RecruitDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'recruit.manage')) notFound();

  const recruit = await getRecruit(params.id);
  if (!recruit) notFound();

  const nixed = recruit.status === 'nixed';
  const converted = recruit.status === 'converted';

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/talent" className="text-ink-3 hover:text-ink">
          ← Back to Talent pipeline
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-ink">
              {recruit.firstName} {recruit.lastName}
            </h1>
            <Badge variant={nixed ? 'red' : converted ? 'green' : 'amber'}>
              {nixed ? 'nixed' : converted ? 'converted' : 'active'}
            </Badge>
            <Badge variant="outline">
              {TARGET_BAND_LABELS[recruit.targetBand]}
            </Badge>
            {recruit.stage && <Badge variant="amber">{recruit.stage}</Badge>}
          </div>
          {recruit.location && (
            <p className="mt-1 text-sm text-ink-3">{recruit.location}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!converted && <PromoteToPersonButton recruitId={recruit.id} />}
          {!converted && (
            <NixToggleButton recruitId={recruit.id} currentStatus={recruit.status} />
          )}
          {converted && recruit.linkedPersonId && (
            <Link
              href={`/directory/people/${recruit.linkedPersonId}`}
              className="inline-flex items-center rounded-md border border-status-green bg-status-green-soft px-3 py-1.5 text-sm font-medium text-status-green hover:bg-status-green/10"
            >
              Open team profile →
            </Link>
          )}
        </div>
      </header>

      {!converted && (
        <Card>
          <CardHeader>
            <CardTitle>Move pool</CardTitle>
            <p className="text-xs text-ink-3">
              Re-tier this prospect by clicking a different pool. Stays in the
              active board.
            </p>
          </CardHeader>
          <CardContent>
            <MoveBandStrip recruitId={recruit.id} currentBand={recruit.targetBand} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Email">
              <InlineRecruitField
                recruitId={recruit.id}
                field="email"
                initialValue={recruit.email}
                inputType="email"
                placeholder="name@example.com"
                canEdit={!converted}
              />
            </Row>
            <Row label="LinkedIn">
              <InlineRecruitField
                recruitId={recruit.id}
                field="linkedinUrl"
                initialValue={recruit.linkedinUrl}
                inputType="url"
                placeholder="https://linkedin.com/in/…"
                canEdit={!converted}
              />
            </Row>
            <Row label="CV">
              <InlineRecruitField
                recruitId={recruit.id}
                field="cvSharepointUrl"
                initialValue={recruit.cvSharepointUrl}
                inputType="url"
                placeholder="https://…sharepoint.com/…"
                canEdit={!converted}
              />
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Owner">
              <span className="inline-flex items-center gap-2">
                <PersonAvatar
                  className="h-5 w-5"
                  fallbackClassName="text-[9px]"
                  initials={recruit.owner.initials}
                  headshotUrl={recruit.owner.headshotUrl}
                />
                {recruit.owner.firstName} {recruit.owner.lastName}
              </span>
            </Row>
            <Row label="Source">
              {recruit.source ?? <span className="text-ink-3">—</span>}
            </Row>
            <Row label="Referred by">
              {recruit.referredBy ? (
                <span>
                  {recruit.referredBy.firstName} {recruit.referredBy.lastName}
                </span>
              ) : (
                <span className="text-ink-3">—</span>
              )}
            </Row>
            <Row label="Added">
              {recruit.createdAt.toLocaleDateString('en-AU')} ·{' '}
              {recruit.daysInPipeline}d ago
            </Row>
            {recruit.closedAt && (
              <Row label="Closed">
                {recruit.closedAt.toLocaleDateString('en-AU')}
              </Row>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <InlineRecruitField
            recruitId={recruit.id}
            field="notes"
            initialValue={recruit.notes}
            variant="textarea"
            placeholder="No notes yet — click to add. What stood out, who they've worked with, expected start date, screening feedback…"
            canEdit={!converted}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 py-1">
      <div className="text-ink-3">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}
