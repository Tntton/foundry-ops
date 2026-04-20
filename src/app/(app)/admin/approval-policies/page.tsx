import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { DEFAULT_POLICIES, listAllPolicies } from '@/server/approval-policies';
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
import { NewPolicyForm, TogglePolicyActive } from './form';

function formatThreshold(cents: number | null, comparator: string): string {
  if (comparator === 'any') return 'any amount';
  if (cents === null) return '—';
  const dollars = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
  const symbol: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };
  return `${symbol[comparator] ?? comparator} ${dollars}`;
}

export default async function ApprovalPoliciesPage() {
  const session = await getSession();
  if (!hasCapability(session, 'approval.policy.edit')) notFound();

  const db = await listAllPolicies();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Approval policies</h1>
        <p className="text-sm text-ink-3">
          Threshold + required-role rules for invoice/expense/bill/pay-run approvals.
          DB policies override the built-in defaults; defaults apply when no DB row matches.
        </p>
      </header>

      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead>Threshold</TableHead>
              <TableHead>Required role</TableHead>
              <TableHead>MFA</TableHead>
              <TableHead>Active</TableHead>
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {db.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {p.subjectType.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono">
                  {formatThreshold(p.thresholdCents, p.comparator)}
                </TableCell>
                <TableCell className="capitalize">{p.requiredRole.replace('_', ' ')}</TableCell>
                <TableCell>{p.requireMfa ? 'yes' : '—'}</TableCell>
                <TableCell>
                  {p.active ? <Badge variant="green">active</Badge> : <Badge variant="outline">off</Badge>}
                </TableCell>
                <TableCell>
                  <Badge variant="blue">DB</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <TogglePolicyActive id={p.id} active={p.active} />
                </TableCell>
              </TableRow>
            ))}
            {DEFAULT_POLICIES.map((p) => (
              <TableRow key={`default-${p.subjectType}-${p.comparator}-${p.requiredRole}`}>
                <TableCell>
                  <Badge variant="outline" className="capitalize">
                    {p.subjectType.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono">
                  {formatThreshold(p.thresholdCents, p.comparator)}
                </TableCell>
                <TableCell className="capitalize">{p.requiredRole.replace('_', ' ')}</TableCell>
                <TableCell>—</TableCell>
                <TableCell>
                  <Badge variant="outline">default</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">code</Badge>
                </TableCell>
                <TableCell />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <NewPolicyForm />

      <div className="rounded-md border border-line bg-surface-subtle p-3 text-xs text-ink-3">
        Disable a DB policy to fall back to the built-in default below it.
        Full inline-edit (comparator / threshold / role in place) lands later — for now,
        disable + add a new row to change. `resolveRequiredRole()` in
        `src/server/approval-policies.ts` checks active DB rows first then defaults.
      </div>
    </div>
  );
}
