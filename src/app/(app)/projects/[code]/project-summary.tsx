import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const STAGE_VARIANT: Record<string, 'amber' | 'green' | 'blue' | 'outline'> = {
  kickoff: 'amber',
  delivery: 'green',
  closing: 'blue',
  archived: 'outline',
};

type PersonLite = {
  initials: string;
  headshotUrl: string | null;
  firstName: string;
  lastName: string;
};

/**
 * Project-level summary — the read-only view a signed-in user sees when
 * they are NOT connected to a project (not on the team, not the manager
 * or lead partner) and don't hold a firm-wide leadership role.
 *
 * All staff can see that a project exists and its top-line identity
 * (code / name / client / stage / leadership / window). Operational and
 * commercial detail — hours, team allocations, P&L, budget, invoices,
 * expenses, risks, checklists — is deliberately withheld here; those
 * live on the full tabbed view for connected people and leaders only.
 */
export function ProjectLevelSummary({
  project,
}: {
  project: {
    code: string;
    name: string;
    description: string | null;
    stage: string;
    startDate: Date | null;
    endDate: Date | null;
    client: { code: string; legalName: string };
    primaryPartner: PersonLite;
    manager: PersonLite;
  };
}) {
  const fmtDate = (d: Date | null) =>
    d
      ? d.toLocaleDateString('en-AU', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : '—';

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-ink-3">{project.code}</span>
            <Badge variant={STAGE_VARIANT[project.stage] ?? 'outline'}>
              {project.stage}
            </Badge>
          </div>
          <h1 className="mt-1 text-xl font-semibold text-ink">{project.name}</h1>
          <p className="text-sm text-ink-3">
            {project.client.legalName}{' '}
            <span className="font-mono text-xs">· {project.client.code}</span>
          </p>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Project overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {project.description && (
            <p className="text-ink-2">{project.description}</p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SummaryPerson label="Lead partner" person={project.primaryPartner} />
            <SummaryPerson label="Manager" person={project.manager} />
            <div>
              <div className="text-xs font-medium text-ink-3">Start</div>
              <div className="text-ink">{fmtDate(project.startDate)}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-ink-3">End</div>
              <div className="text-ink">{fmtDate(project.endDate)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-ink-4">
        You&apos;re not on this project, so operational and commercial detail
        is hidden. Ask the lead partner or manager if you need access.
      </p>
    </div>
  );
}

function SummaryPerson({
  label,
  person,
}: {
  label: string;
  person: PersonLite;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <PersonAvatar
          className="h-6 w-6"
          fallbackClassName="text-[10px]"
          initials={person.initials}
          headshotUrl={person.headshotUrl}
        />
        <span className="text-ink">
          {person.firstName} {person.lastName}
        </span>
      </div>
    </div>
  );
}
