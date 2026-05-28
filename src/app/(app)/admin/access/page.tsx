import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Role } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { prisma } from '@/server/db';
import {
  CAPABILITY_ROLES,
  type Capability,
} from '@/server/capabilities';
import { NAV_GROUPS } from '@/components/shell/nav-config';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PersonAvatar } from '@/components/person-avatar';

/**
 * Access-matrix surface for admins. Shows two tables, both
 * sourced live from the system-of-record configs so they can
 * never drift from runtime behaviour:
 *
 *   1. **Nav visibility** — which sidebar item each role sees,
 *      drawn from NAV_GROUPS.
 *   2. **Capability matrix** — every server-side capability gate
 *      (CAPABILITY_ROLES) × role.
 *
 * Plus a "Contextual restrictions" callout listing the per-handler
 * scope rules that aren't expressed in the coarse capability table
 * (e.g. "manager can approve expenses, but only on their projects").
 * These live in code, not config — they're documented here so the
 * matrix isn't read as the whole picture.
 *
 * Gated to admin / super_admin: this is sensitive ops info (who
 * can do what across the firm).
 */

const ROLES_IN_ORDER: readonly Role[] = [
  'super_admin',
  'admin',
  'partner',
  'associate_partner',
  'manager',
  'staff',
];

const ROLE_LABEL: Record<Role, string> = {
  super_admin: 'Super-admin',
  admin: 'Admin',
  partner: 'Partner',
  associate_partner: 'Associate Partner',
  manager: 'Manager',
  staff: 'Staff',
};

/**
 * Group capabilities by the first dot-segment (e.g. `invoice.*`,
 * `expense.*`) so the table reads as a section'd ledger rather
 * than a 40-row alphabetical wall. Pretty-name + ordering captured
 * here; unknown groups fall through to "Other".
 */
type CapabilityGroup = {
  id: string;
  label: string;
  description: string;
};
const CAPABILITY_GROUPS: CapabilityGroup[] = [
  { id: 'invoice', label: 'Invoices', description: 'Create, send, approve, delete client-facing invoices.' },
  { id: 'expense', label: 'Expenses', description: 'Personal-reimbursement receipts. Manager + AP can approve up to $2k on their projects; super_admin signs off >$2k.' },
  { id: 'bill', label: 'Bills (AP)', description: 'Vendor invoices that Foundry pays. Approval is super_admin only per A8 governance.' },
  { id: 'payrun', label: 'Pay runs', description: 'Salary + contractor payment cycles. Super_admin approves; admin can prepare.' },
  { id: 'project', label: 'Projects', description: 'Create, edit, delete projects. Edit gated to project-owners at handler level.' },
  { id: 'person', label: 'Directory (People)', description: 'Add, edit, archive team members. Hard delete only for never-used records.' },
  { id: 'client', label: 'Clients', description: 'Create + edit client orgs. Delete only when no projects are attached.' },
  { id: 'deal', label: 'BD pipeline', description: 'Create + edit business-development deals.' },
  { id: 'ratecard', label: 'Rate card', description: 'View + edit Foundry rate card.' },
  { id: 'partner', label: 'Partner-only', description: 'Surfaces reserved for full partners. Associate Partners are explicitly excluded.' },
  { id: 'integration', label: 'Integrations', description: 'Connect / disconnect external systems (Xero, Navan, Uber, M365).' },
  { id: 'agent', label: 'Agents', description: 'Trigger AI agent runs (OCR, drafter, reconciler).' },
  { id: 'auditlog', label: 'Audit log', description: 'View the firm-wide audit trail.' },
  { id: 'approval', label: 'Approval policies', description: 'Configure the per-subject approval thresholds + required roles.' },
  { id: 'timesheet', label: 'Timesheets', description: 'Submit own hours. Approval is configured via the approval-policies surface.' },
];

function groupForCapability(cap: Capability): CapabilityGroup {
  const head = cap.split('.')[0];
  return (
    CAPABILITY_GROUPS.find((g) => g.id === head) ?? {
      id: 'other',
      label: 'Other',
      description: 'Uncategorised capabilities — likely a newly-added gate needing a group entry.',
    }
  );
}

/**
 * Human-readable label for a capability id. Strips the section
 * prefix and any threshold suffix, sentence-cases the result.
 */
function labelForCapability(cap: Capability): string {
  // Bespoke labels for the bits where a mechanical translation
  // loses meaning.
  const overrides: Partial<Record<Capability, string>> = {
    'invoice.approve.over_20k': 'Approve invoices over $20k',
    'invoice.approve.under_20k': 'Approve invoices up to $20k',
    'expense.approve.over_2k': 'Approve expenses over $2k',
    'expense.approve.under_2k': 'Approve expenses up to $2k',
    'partner.scorecard.view': 'View partner scorecard',
    'integration.manage': 'Manage integrations',
    'auditlog.view': 'View audit log',
    'agent.run_manual': 'Run agent manually',
    'approval.policy.edit': 'Edit approval policies',
    'ratecard.view': 'View rate card',
    'ratecard.edit': 'Edit rate card',
    'invoice.delete_draft': 'Delete draft invoices',
    'bill.delete_draft': 'Delete draft bills',
    'project.delete': 'Hard-delete a project',
    'person.delete': 'Hard-delete a person',
    'client.delete': 'Hard-delete a client',
  };
  if (overrides[cap]) return overrides[cap]!;
  // Default: strip the head segment, replace dots with spaces,
  // sentence-case.
  const trimmed = cap
    .split('.')
    .slice(1)
    .join(' ')
    .replace(/_/g, ' ');
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export default async function AccessMatrixPage() {
  const session = await getSession();
  if (!session || !hasAnyRole(session, ['super_admin', 'admin'])) notFound();

  // Current role holders — every active person × the roles they
  // hold. A person with multiple roles (e.g. TT = super_admin +
  // partner) appears under each. Inactive people are excluded so
  // the table reflects who is *actually* exercising authority
  // today, not historic grants. Sorted alphabetically by last name
  // within each role bucket.
  const activePeople = await prisma.person.findMany({
    where: { inactiveAt: null },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: {
      id: true,
      initials: true,
      firstName: true,
      lastName: true,
      headshotUrl: true,
      band: true,
      level: true,
      roles: true,
    },
  });
  type Holder = (typeof activePeople)[number];
  const holdersByRole = new Map<Role, Holder[]>();
  for (const role of ROLES_IN_ORDER) holdersByRole.set(role, []);
  for (const p of activePeople) {
    for (const r of p.roles) {
      const bucket = holdersByRole.get(r);
      if (bucket) bucket.push(p);
    }
  }

  // Group capabilities for the table sections.
  type GroupedRow = { group: CapabilityGroup; rows: Capability[] };
  const groupedCapabilities: GroupedRow[] = [];
  for (const cap of Object.keys(CAPABILITY_ROLES) as Capability[]) {
    const g = groupForCapability(cap);
    let bucket = groupedCapabilities.find((x) => x.group.id === g.id);
    if (!bucket) {
      bucket = { group: g, rows: [] };
      groupedCapabilities.push(bucket);
    }
    bucket.rows.push(cap);
  }
  // Order groups by the canonical CAPABILITY_GROUPS list, then any
  // leftover "Other" group at the end.
  groupedCapabilities.sort((a, b) => {
    const ai = CAPABILITY_GROUPS.findIndex((g) => g.id === a.group.id);
    const bi = CAPABILITY_GROUPS.findIndex((g) => g.id === b.group.id);
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });

  // Flatten nav items per role for the visibility matrix.
  const navItems = NAV_GROUPS.flatMap((g) =>
    g.items.map((i) => ({ group: g.label, item: i })),
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Access matrix</h1>
        <p className="text-sm text-ink-3">
          Who-can-do-what across the platform, sourced live from the
          system-of-record configs (no drift risk — same data the
          server uses to gate every action).
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Roles in the system</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <RoleBlurb
            role="super_admin"
            blurb="Top-tier — every capability granted. Currently TT + Jas. Use sparingly; per A8 governance, the over-threshold gates (>$20k invoices, >$2k expenses, bill approval) are super_admin-only by design."
          />
          <RoleBlurb
            role="admin"
            blurb="Firm-operations seat. Approves under-threshold expenses, manages integrations, runs agent jobs manually, sees the audit log. Does NOT approve invoices > $20k or bills (super_admin only)."
          />
          <RoleBlurb
            role="partner"
            blurb="Full delivery partner. BD pipeline, project leadership, invoice approval up to $20k, partner-scorecard visibility. The only role besides admin/super_admin that sees the firm-wide partner-attribution surface."
          />
          <RoleBlurb
            role="associate_partner"
            blurb="Associate Partner / Director. Junior to partner — same project-leadership + BD + invoice-approval rights, but explicitly excluded from the partner scorecard. Two rem models running side-by-side: time billing (Person.rate × hours) + LT share fees when leading a project."
          />
          <RoleBlurb
            role="manager"
            blurb="Project manager. Can approve timesheets + expenses up to $2k on projects they lead. No BD or invoice-approval rights."
          />
          <RoleBlurb
            role="staff"
            blurb="Consultant tier. Submits timesheets + expenses. No approval rights. Sees stripped directory view + own projects on dashboard."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current role holders</CardTitle>
          <p className="text-xs text-ink-3">
            Active people across the firm by role. A person with
            multiple roles appears under each (e.g. a super-admin who
            also leads projects shows up under Super-admin and
            Partner). Inactive / end-dated profiles are hidden — to
            review historical grants, open the audit log.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {ROLES_IN_ORDER.map((role) => {
            const holders = holdersByRole.get(role) ?? [];
            return (
              <div
                key={role}
                className="rounded-md border border-line bg-surface-subtle/40 px-3 py-2"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    {ROLE_LABEL[role]}
                  </Badge>
                  <span className="text-xs text-ink-3">
                    {holders.length === 0
                      ? 'No one currently holds this role'
                      : `${holders.length} ${holders.length === 1 ? 'person' : 'people'}`}
                  </span>
                </div>
                {holders.length === 0 ? (
                  <p className="text-xs text-ink-4">—</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {holders.map((p) => (
                      <li key={p.id}>
                        <Link
                          href={`/directory/people/${p.id}`}
                          className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-2 py-1 text-xs hover:border-brand hover:bg-surface-hover"
                          title={`${p.firstName} ${p.lastName} · ${p.band ?? ''} ${p.level ?? ''}`.trim()}
                        >
                          <PersonAvatar
                            className="h-5 w-5"
                            fallbackClassName="text-[9px]"
                            initials={p.initials}
                            headshotUrl={p.headshotUrl}
                          />
                          <span className="text-ink">
                            {p.firstName} {p.lastName}
                          </span>
                          {p.band && (
                            <span className="text-[10px] text-ink-3">
                              {p.band.replace(/_/g, ' ')}
                              {p.level ? ` · ${p.level}` : ''}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sidebar nav visibility</CardTitle>
        </CardHeader>
        <CardContent className="-mx-2 overflow-x-auto px-2">
          <MatrixTable
            columnHead="Nav item"
            rows={navItems.map(({ group, item }) => ({
              id: item.href,
              section: group,
              label: item.label,
              roles: item.roles,
              hint: item.href,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Server-side capabilities</CardTitle>
          <p className="text-xs text-ink-3">
            Every mutating server action / sensitive read gates on
            one of these. Tick = role can call the gate; blank =
            denied with{' '}
            <code className="font-mono">UnauthorizedError</code> at
            the handler. Some grants are further restricted by
            project-ownership rules — see the &ldquo;Contextual
            restrictions&rdquo; list below.
          </p>
        </CardHeader>
        <CardContent className="-mx-2 overflow-x-auto px-2">
          {groupedCapabilities.map((bucket) => (
            <div key={bucket.group.id} className="mb-6 last:mb-0">
              <div className="mb-1 px-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                  {bucket.group.label}
                </div>
                <p className="text-[11px] text-ink-3">
                  {bucket.group.description}
                </p>
              </div>
              <MatrixTable
                columnHead="Capability"
                rows={bucket.rows.map((cap) => ({
                  id: cap,
                  label: labelForCapability(cap),
                  hint: cap,
                  roles: CAPABILITY_ROLES[cap],
                }))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contextual restrictions</CardTitle>
          <p className="text-xs text-ink-3">
            Some capabilities pass the coarse role check above but
            are further narrowed at the handler. These rules live in
            code; documented here so the matrix isn&apos;t read as
            the whole picture.
          </p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Restriction
            roles={['manager', 'associate_partner']}
            cap="expense.approve.under_2k"
            note="Restricted to expenses on projects where the actor is the project manager or primary partner. Other projects bounce server-side."
          />
          <Restriction
            roles={['partner', 'associate_partner', 'manager']}
            cap="project.edit"
            note="Restricted to projects where the actor is the manager or primary partner. Cross-project edits require admin."
          />
          <Restriction
            roles={['super_admin']}
            cap="project.delete"
            note="Refused if the project has any financial children (invoices, bills, expenses, timesheets, deals). Archive is the typical end-of-engagement tool."
          />
          <Restriction
            roles={['super_admin']}
            cap="client.delete"
            note="Refused if the client has any projects, deals, or invoices attached."
          />
          <Restriction
            roles={['super_admin']}
            cap="person.delete"
            note="Refused when the person has any transactional footprint (timesheets, expenses, owned clients/projects/deals, team memberships, approvals, risks, or audit events). Archive is the typical end-of-tenure tool."
          />
          <Restriction
            roles={['associate_partner']}
            cap="partner.scorecard.view"
            note="EXPLICITLY denied. Associate Partners are junior to partner — they share most decision authority but never see the firm-wide partner-attribution surface."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function MatrixTable({
  columnHead,
  rows,
}: {
  columnHead: string;
  rows: Array<{
    id: string;
    section?: string;
    label: string;
    hint?: string;
    roles: readonly Role[];
  }>;
}) {
  // Group by section when present (used by the nav-visibility table
  // to surface "Workspace" / "Reports" headers).
  const sections = new Map<string | undefined, typeof rows>();
  for (const r of rows) {
    const key = r.section;
    const bucket = sections.get(key) ?? [];
    bucket.push(r);
    sections.set(key, bucket);
  }

  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 z-10 bg-card text-[11px] text-ink-3">
        <tr className="border-b border-line">
          <th className="py-2 pl-2 pr-3 text-left font-medium">
            {columnHead}
          </th>
          {ROLES_IN_ORDER.map((r) => (
            <th
              key={r}
              className="px-2 py-2 text-center font-medium whitespace-nowrap"
            >
              {ROLE_LABEL[r]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from(sections.entries()).map(([sectionLabel, sectionRows]) => (
          <Fragment key={sectionLabel ?? '_'}>
            {sectionLabel && (
              <tr>
                <td
                  colSpan={ROLES_IN_ORDER.length + 1}
                  className="bg-surface-subtle/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3"
                >
                  {sectionLabel}
                </td>
              </tr>
            )}
            {sectionRows.map((row) => (
              <tr key={row.id} className="border-b border-line">
                <td className="py-1.5 pl-2 pr-3">
                  <div className="text-ink">{row.label}</div>
                  {row.hint && (
                    <div className="font-mono text-[10px] text-ink-4">
                      {row.hint}
                    </div>
                  )}
                </td>
                {ROLES_IN_ORDER.map((r) => {
                  const granted = row.roles.includes(r);
                  return (
                    <td
                      key={r}
                      className={`px-2 py-1 text-center ${
                        granted
                          ? 'bg-status-green-soft/40 text-status-green'
                          : 'text-ink-4'
                      }`}
                      title={
                        granted ? `${ROLE_LABEL[r]} can do this` : `${ROLE_LABEL[r]} cannot do this`
                      }
                    >
                      {granted ? '✓' : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function RoleBlurb({ role, blurb }: { role: Role; blurb: string }) {
  return (
    <div className="flex gap-3">
      <Badge variant="outline" className="shrink-0 font-mono">
        {ROLE_LABEL[role]}
      </Badge>
      <span className="text-ink-2">{blurb}</span>
    </div>
  );
}

function Restriction({
  roles,
  cap,
  note,
}: {
  roles: Role[];
  cap: Capability;
  note: string;
}) {
  return (
    <div className="rounded-md border border-line bg-surface-subtle/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1 text-xs text-ink-3">
        {roles.map((r) => (
          <Badge key={r} variant="outline" className="font-mono text-[10px]">
            {ROLE_LABEL[r]}
          </Badge>
        ))}
        <span>·</span>
        <code className="font-mono text-[10px]">{cap}</code>
      </div>
      <p className="mt-1 text-ink-2">{note}</p>
    </div>
  );
}

// Fragment needs an import — typing it explicitly here so the
// component file doesn't need a separate React import.
import { Fragment } from 'react';
