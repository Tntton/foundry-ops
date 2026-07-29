import { Fragment } from 'react';
import type { Role } from '@prisma/client';
import { getSession } from '@/server/session';
import { PrintButton } from './print-button';

export const metadata = {
  title: 'Platform overview',
};

/**
 * Platform overview — a role × capability access matrix that every
 * signed-in person can refer to. Reachable from the top-nav link beside
 * the search bar (see components/shell/topbar.tsx).
 *
 * Access: visible to everyone signed in. It exposes no data — only the
 * shape of what each role is allowed to do — so there's no role gate.
 * The signed-in person's own role column(s) are highlighted.
 *
 * This mirrors the permission model in HANDOFF §1 and the role-filtered
 * nav in shell/nav-config.ts. When capabilities move, update this table
 * alongside CAPABILITY_ROLES so the reference stays honest.
 */

type Access = 'yes' | 'own' | 'appr' | 'ro' | 'band' | 'no';

type Col = { key: string; short: string; label: string; role: Role };

const COLS: Col[] = [
  { key: 'sa', short: 'SA', label: 'Super Admin', role: 'super_admin' },
  { key: 'ad', short: 'AD', label: 'Admin', role: 'admin' },
  { key: 'pa', short: 'PA', label: 'Partner', role: 'partner' },
  { key: 'ap', short: 'AP', label: 'Assoc. Ptnr', role: 'associate_partner' },
  { key: 'mg', short: 'MG', label: 'Manager', role: 'manager' },
  { key: 'st', short: 'ST', label: 'Staff', role: 'staff' },
];

// Compact encoding, one entry per column in COLS order.
// y=full · o=own scope · a=approval-gated · r=read-only · b=band-excluded · n=none
type Row = { cap: string; cells: [Access, Access, Access, Access, Access, Access] };
type Group = { title: string; rows: Row[] };

const CODE: Record<string, Access> = {
  y: 'yes', o: 'own', a: 'appr', r: 'ro', b: 'band', n: 'no',
};
const row = (cap: string, s: string): Row => ({
  cap,
  cells: s.split('').map((c) => CODE[c]) as Row['cells'],
});

const GROUPS: Group[] = [
  {
    title: 'Delivery & pipeline',
    rows: [
      //                                              SA AD PA AP MG ST
      row('View projects (firm-wide, project level)', 'yyyyyy'),
      row('Create project', 'yyyynn'),
      row('Manage project (team, budget, milestones, risks)', 'yyooon'),
      row('Close project', 'yaoonn'),
      row('BD pipeline', 'yyyyyn'),
      row('Resource planning', 'ybyyyn'),
      row('Talent pipeline', 'yyyyyn'),
    ],
  },
  {
    title: 'Financial reporting',
    rows: [
      row('Firm P&L', 'yyynnn'),
      row('Balance sheet (operational)', 'yyynnn'),
      row('Receivables (AR aging)', 'yyynnn'),
      row('Payables (AP aging)', 'yynnnn'),
      row('Reimbursables', 'yynnnn'),
      row('Cash flow', 'yynnnn'),
      row('Partner scorecard', 'yyynnn'),
      row('Project-level P&L', 'yyooon'),
    ],
  },
  {
    title: 'Money movement',
    rows: [
      row('Invoices working list (AR)', 'yyyyyn'),
      row('Draft / raise invoice', 'yyoonn'),
      row('Approve invoice (in policy, ≤$20k)', 'yyoonn'),
      row('Approve invoice above $20k', 'ynnnnn'),
      row('Send invoice to client', 'yynnnn'),
      row('Bills working list (AP)', 'yynnnn'),
      row('Approve supplier bill', 'yannnn'),
      row('OPEX tracker', 'yynnnn'),
      row('Pay runs / generate ABA', 'yynnnn'),
      row('Approve pay run', 'ynnnnn'),
    ],
  },
  {
    title: 'People & directory',
    rows: [
      row('View directory', 'yyyyyr'),
      row('Add person (provisions M365 account)', 'yynnnn'),
      row('Edit person / manage directory', 'yynnnn'),
      row("View others' rate & salary", 'yynnnn'),
      row('View / edit bank & PII (encrypted)', 'yynnnn'),
      row('Set rate card', 'ynnnnn'),
      row('View own profile, rate & utilisation', 'yyyyyy'),
    ],
  },
  {
    title: 'Individual inputs',
    rows: [
      row('Log own timesheet', 'yyyyyy'),
      row('Availability forecast', 'ybyyyy'),
      row('Submit expense / upload receipt', 'yyyyyy'),
      row('Approve team timesheets', 'yyooon'),
      row('Approvals inbox', 'yyyyyn'),
    ],
  },
  {
    title: 'System & governance',
    rows: [
      row('Manage integrations', 'yynnnn'),
      row('Approval policies (thresholds)', 'ynnnnn'),
      row('Access matrix (view)', 'yynnnn'),
      row('Data imports & exports', 'yynnnn'),
      row('Reconcile workspace', 'ynnnnn'),
      row('Audit log', 'ynnnnn'),
      row('Feedback triage', 'yynnnn'),
      row('System status', 'yynnnn'),
      row('Submit feedback (widget)', 'yyyyyy'),
    ],
  },
];

const ROLE_SUMMARY: { key: string; short: string; label: string; blurb: string; signin: string }[] = [
  { key: 'sa', short: 'SA', label: 'Super Admin', blurb: 'Managing Partner. Every authority; the only role that can approve above the configured thresholds.', signin: 'M365 SSO' },
  { key: 'ad', short: 'AD', label: 'Admin', blurb: 'Office Manager. Runs the back office and approves within policy; no final partner sign-off.', signin: 'M365 SSO' },
  { key: 'pa', short: 'PA', label: 'Partner', blurb: 'Sees firm finance and their own book; approves their own client invoices in policy.', signin: 'M365 SSO' },
  { key: 'ap', short: 'AP', label: 'Associate Partner', blurb: 'Delivery, pipeline, and resourcing. No firm financial reporting.', signin: 'M365 SSO' },
  { key: 'mg', short: 'MG', label: 'Manager', blurb: 'Their own projects: team, budget, milestones, risks. No firm finance.', signin: 'M365 SSO' },
  { key: 'st', short: 'ST', label: 'Staff / contractor', blurb: 'Logs own time and expenses; views own profile, rate, and utilisation.', signin: 'SSO, or magic link for contractors' },
];

const CHIP: Record<string, string> = {
  sa: 'bg-brand text-white',
  ad: 'bg-brand-light text-white',
  pa: 'bg-brand-soft text-brand',
  ap: 'bg-surface-subtle text-ink-2 border border-line-strong',
  mg: 'bg-surface-subtle text-ink-3 border border-line-strong',
  st: 'bg-transparent text-ink-3 border border-line-strong',
};

function Chip({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex h-[19px] min-w-[26px] items-center justify-center rounded px-1.5 text-[10.5px] font-bold tracking-wide ${CHIP[k] ?? ''}`}
    >
      {children}
    </span>
  );
}

function Mark({ a }: { a: Access }) {
  switch (a) {
    case 'yes':
      return (
        <span
          title="Full access"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[12px] font-bold text-white"
        >
          ✓
        </span>
      );
    case 'own':
      return (
        <span
          title="Own projects / clients only"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-brand text-[12px] font-bold text-brand"
        >
          ✓
        </span>
      );
    case 'appr':
      return (
        <span
          title="Can act; above the threshold it escalates to Super Admin"
          className="inline-flex h-5 w-5 items-center justify-center text-[14px] text-gold"
        >
          ✋
        </span>
      );
    case 'ro':
      return (
        <span
          title="Read-only"
          className="inline-flex items-center justify-center rounded border border-line-strong px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-3"
        >
          view
        </span>
      );
    case 'band':
      return (
        <span className="inline-flex items-center gap-0.5">
          <span
            title="Role allows it, but the Office Manager (Support_Staff band) is excluded"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-dashed border-line-strong bg-surface-subtle text-[12px] font-bold text-ink-3"
          >
            ✓
          </span>
          <sup className="text-[10px] text-ink-3">†</sup>
        </span>
      );
    default:
      return (
        <span title="No access" className="text-[13px] font-bold text-line-strong">
          –
        </span>
      );
  }
}

export default async function PlatformOverviewPage() {
  const session = await getSession();
  const myRoles = new Set<Role>(session?.person.roles ?? []);
  const isYou = (col: Col) => myRoles.has(col.role);

  return (
    <div className="space-y-6">
      {/* Print stylesheet — hides the app chrome + floating widgets and
          switches to landscape so the browser's Save-as-PDF yields a
          clean access-matrix sheet. Scoped by living on this route only. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  aside, header, .fixed, .fh-no-print { display: none !important; }
  main { overflow: visible !important; padding: 0 !important; }
  @page { size: A4 landscape; margin: 12mm; }
}`,
        }}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Platform overview</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-3">
            Who can do what. Access is deny-by-default and enforced server-side on every action; this
            table reflects the same model that gates the product. Your own role is highlighted.
          </p>
        </div>
        <PrintButton />
      </div>

      {/* Role summary cards */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {ROLE_SUMMARY.map((r) => {
          const you = myRoles.has(COLS.find((c) => c.key === r.key)!.role);
          return (
            <div
              key={r.key}
              className={`bg-surface-elev p-4 ${you ? 'ring-1 ring-inset ring-brand' : ''}`}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <Chip k={r.key}>{r.short}</Chip>
                <b className="text-sm text-ink">{r.label}</b>
                {you && (
                  <span className="ml-auto rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand">
                    You
                  </span>
                )}
              </div>
              <p className="mb-1.5 text-[12.5px] leading-snug text-ink-2">{r.blurb}</p>
              <p className="text-[11px] uppercase tracking-wide text-ink-3">Signs in via {r.signin}</p>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-line bg-surface-elev px-4 py-3 text-[12.5px] text-ink-2">
        <span className="inline-flex items-center gap-2"><Mark a="yes" /> Full access</span>
        <span className="inline-flex items-center gap-2"><Mark a="own" /> Own projects / clients</span>
        <span className="inline-flex items-center gap-2"><Mark a="appr" /> Escalates above threshold</span>
        <span className="inline-flex items-center gap-2"><Mark a="ro" /> Read-only</span>
        <span className="inline-flex items-center gap-2"><Mark a="no" /> No access</span>
        <span className="inline-flex items-center gap-2"><b className="text-ink-3">†</b> Office Manager band excluded</span>
      </div>

      {/* Matrix */}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className="w-[34%] border-b border-line bg-surface-subtle px-3 py-2 text-left font-bold text-ink">
                Capability
              </th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={`border-b border-line px-2 py-2 text-center align-bottom ${
                    isYou(c) ? 'bg-brand-soft' : 'bg-surface-subtle'
                  }`}
                >
                  <div className="flex flex-col items-center gap-1">
                    <Chip k={c.key}>{c.short}</Chip>
                    <span className="text-[9.5px] font-normal text-ink-3">{c.label}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => (
              <Fragment key={g.title}>
                <tr>
                  <td
                    colSpan={COLS.length + 1}
                    className="bg-brand-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wider text-brand"
                  >
                    {g.title}
                  </td>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.cap} className="hover:bg-surface-hover">
                    <td className="border-b border-line px-3 py-2 text-ink-2">{r.cap}</td>
                    {r.cells.map((a, i) => {
                      const col = COLS[i]!;
                      return (
                        <td
                          key={col.key}
                          className={`border-b border-line px-2 py-2 text-center ${
                            isYou(col) ? 'bg-surface-subtle' : ''
                          }`}
                        >
                          <Mark a={a} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="border-l-2 border-brand-light pl-3 text-[12px] text-ink-3">
        Scope markers matter: an owned tick means the person acts only on their own projects or
        clients, not firm-wide. The escalation marker means the action is allowed but crosses the
        configured threshold ($20k invoice, $2k expense, every pay run) to the Super Admin.
      </p>
    </div>
  );
}
