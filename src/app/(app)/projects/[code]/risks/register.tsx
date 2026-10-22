import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { NewRiskForm, RiskInlineSelect } from './form';

const SEVERITY_VARIANT: Record<string, 'outline' | 'amber' | 'red'> = {
  low: 'outline',
  medium: 'amber',
  high: 'red',
};
const STATUS_VARIANT: Record<string, 'amber' | 'blue' | 'green'> = {
  open: 'amber',
  mitigating: 'blue',
  closed: 'green',
};

type RiskRow = {
  id: string;
  title: string;
  ownerId: string | null;
  severity: string;
  status: string;
  mitigation: string | null;
};

type PersonOpt = {
  id: string;
  initials: string;
  headshotUrl: string | null;
  firstName: string;
  lastName: string;
};

/**
 * Risk register — the table of logged delivery risks plus (for editors)
 * the inline "Log risk" form. Shared by the standalone
 * /projects/[code]/risks page and the "Risks" tab on the project detail
 * page so the two surfaces can never drift apart.
 *
 * `canEdit` gates every mutation surface: the inline severity/status
 * selects (which call the project.edit-guarded updateRiskField action)
 * and the new-risk form. Read-only viewers still see the full register.
 */
export function RiskRegister({
  projectId,
  risks,
  people,
  canEdit,
}: {
  projectId: string;
  risks: RiskRow[];
  people: PersonOpt[];
  canEdit: boolean;
}) {
  const peopleById = new Map(people.map((p) => [p.id, p]));

  return (
    <div className="space-y-4">
      <Card className="p-0">
        {risks.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            No risks logged yet.
            {canEdit ? ' Add one below.' : ''}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Mitigation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {risks.map((r) => {
                const owner = r.ownerId ? peopleById.get(r.ownerId) : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-ink">{r.title}</TableCell>
                    <TableCell>
                      {owner ? (
                        <div className="flex items-center gap-2">
                          <PersonAvatar
                            className="h-6 w-6"
                            fallbackClassName="text-[10px]"
                            initials={owner.initials}
                            headshotUrl={owner.headshotUrl}
                          />
                          <span className="text-sm text-ink-2">
                            {owner.firstName} {owner.lastName}
                          </span>
                        </div>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={SEVERITY_VARIANT[r.severity] ?? 'outline'}>
                          {r.severity}
                        </Badge>
                        {canEdit && (
                          <RiskInlineSelect
                            riskId={r.id}
                            field="severity"
                            current={r.severity}
                            options={['low', 'medium', 'high']}
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={STATUS_VARIANT[r.status] ?? 'outline'}>
                          {r.status}
                        </Badge>
                        {canEdit && (
                          <RiskInlineSelect
                            riskId={r.id}
                            field="status"
                            current={r.status}
                            options={['open', 'mitigating', 'closed']}
                          />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-sm text-sm text-ink-2">
                      {r.mitigation ?? <span className="text-ink-4">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {canEdit && <NewRiskForm projectId={projectId} people={people} />}
    </div>
  );
}
