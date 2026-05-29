import type { Role, Band } from '@prisma/client';
import {
  LayoutDashboard,
  FolderKanban,
  Inbox,
  Users,
  Clock,
  Receipt,
  FileText,
  Shield,
  Plug,
  ScrollText,
  CircleDollarSign,
  Sparkles,
  BarChart3,
  HandCoins,
  Gauge,
  Wallet,
  TrendingUp,
  LineChart,
  Banknote,
  UserSquare,
  KeyRound,
  Database,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: readonly Role[]; // empty array = visible to everyone signed-in
  badge?: string;
  /** Bands whose holders should NOT see this item even if their role
   *  would otherwise grant access. Used for delivery-side surfaces
   *  (Availability, Resource planning) that shouldn't surface for the
   *  Office Manager (Support_Staff) even though she's `admin`. */
  denyBands?: readonly Band[];
};

export type NavGroup = {
  id: string;
  label: string;
  items: readonly NavItem[];
};

/**
 * Role-filtered main navigation. Groups match the prototype's
 * Workspace / Inputs / System structure. Edit here, not in the
 * Sidebar component.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      {
        label: 'Dashboard',
        href: '/',
        icon: LayoutDashboard,
        // Visible to everyone. For staff (and managers without leader
        // duties), the dashboard is the consolidated home — it shows
        // their active projects + the updates feed in one view, so
        // there's no separate Projects nav entry to chase.
        roles: ['super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff'],
      },
      // Updates tab removed — the dashboard already surfaces the
      // unread feed via <LatestUpdatesCard>, plus the unread badge
      // next to "Dashboard" in this same nav. The /updates route
      // remains reachable via direct URL for the full history if
      // anyone needs it; simply not promoted in the sidebar.
      {
        // Projects is the leader's working surface — kanban / grid /
        // table across the whole firm. Staff don't need it; their
        // active projects already live on the dashboard.
        label: 'Projects',
        href: '/projects',
        icon: FolderKanban,
        roles: ['super_admin', 'admin', 'partner', 'associate_partner', 'manager'],
      },
      {
        // BD sits directly under Projects so the pipeline → delivery
        // path reads top-to-bottom in the sidebar.
        label: 'BD pipeline',
        href: '/bd',
        icon: TrendingUp,
        roles: ['super_admin', 'admin', 'partner', 'associate_partner'],
      },
      {
        label: 'Approvals',
        href: '/approvals',
        icon: Inbox,
        roles: ['super_admin', 'admin', 'partner', 'associate_partner', 'manager'],
      },
      {
        label: 'Resource planning',
        href: '/resource-planning',
        icon: Gauge,
        // Delivery-side capacity tool. Support_Staff (Office Manager
        // etc.) hold the admin role for ops work but have no business
        // looking at the bandwidth heatmap — explicitly excluded.
        roles: ['super_admin', 'admin', 'partner', 'associate_partner'],
        denyBands: ['Support_Staff'],
      },
      {
        // Talent pipeline — kanban tracker for prospective hires
        // across the 5 band pools + Nixed. Open to all leadership
        // tiers (super_admin / admin / partner / AP / manager) so
        // anyone driving conversations with prospects can input +
        // own them. Staff don't see it — pre-employment notes are
        // partner-track sensitive. Slotted next to Resource planning
        // to keep the "current capacity" → "future capacity" cluster
        // contiguous, immediately above the Directory (where
        // converted hires land).
        label: 'Talent pipeline',
        href: '/talent',
        icon: UserSquare,
        roles: ['super_admin', 'admin', 'partner', 'associate_partner', 'manager'],
      },
      {
        label: 'Directory',
        href: '/directory',
        icon: Users,
        // Open to everyone signed in. Staff see a stripped read-only
        // view (Person / Band-Level / Region only); leaders see the
        // full surface with tabs and profile click-through.
        roles: ['super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff'],
      },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    items: [
      {
        label: 'P&L',
        href: '/pnl',
        icon: BarChart3,
        roles: ['super_admin', 'admin', 'partner', 'associate_partner'],
      },
      {
        // Operational balance sheet — AR + AP + WIP + bank. NOT a
        // substitute for Xero's official BS; flagged on the page
        // itself. Same audience as P&L (partner-tier+).
        label: 'Balance sheet',
        href: '/balance-sheet',
        icon: BarChart3,
        roles: ['super_admin', 'admin', 'partner', 'associate_partner'],
      },
      {
        label: 'Receivables',
        href: '/receivables',
        icon: HandCoins,
        roles: ['super_admin', 'admin', 'partner', 'associate_partner'],
      },
      {
        label: 'Payables',
        href: '/payables',
        icon: Wallet,
        roles: ['super_admin', 'admin'],
      },
      {
        label: 'Reimbursables',
        href: '/reimbursables',
        icon: Receipt,
        roles: ['super_admin', 'admin'],
      },
      {
        label: 'Cash flow',
        href: '/cashflow',
        icon: LineChart,
        // Admin-only: partners see firm P&L + receivables, but cash
        // flow stays restricted to the operations seat.
        roles: ['super_admin', 'admin'],
      },
      {
        label: 'Partner scorecard',
        href: '/partners',
        icon: UserSquare,
        // EXPLICITLY excludes 'associate_partner' — APs are junior to
        // partner and don't see the firm-wide partner-attribution
        // surface. Mirrors the `partner.scorecard.view` capability.
        roles: ['super_admin', 'admin', 'partner'],
      },
    ],
  },
  {
    // Day-to-day input surfaces every staff member uses — log time, drop a
    // receipt, track the resulting reimbursement. Visible to all signed-in
    // people. Receipt Upload double-routes to vendor bills for admins, but
    // the page handles that in-context with the per-row kind toggle, so
    // there's no second nav entry needed for them.
    id: 'inputs-individual',
    label: 'Individual Inputs',
    items: [
      {
        label: 'Timesheet',
        href: '/timesheet',
        icon: Clock,
        roles: ['super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff'],
      },
      {
        label: 'Availability forecast',
        href: '/availability',
        icon: Gauge,
        // Sister surface to Timesheet — declare expected hours per
        // upcoming week so resourcing partners can plan against latent
        // capacity. Same audience as the timesheet (everyone) EXCEPT
        // Support_Staff (Office Manager etc.), whose hours don't
        // contribute to the bandwidth heatmap and who'd see an empty
        // 8-week grid.
        roles: ['super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff'],
        denyBands: ['Support_Staff'],
      },
      {
        label: 'Receipt Upload',
        href: '/bills/intake',
        icon: Inbox,
        // Open to every staff member — `expense.submit` (any role) is the
        // gate enforced server-side. Vendor-bill uploads still require
        // bill.create, but the page renders an expense-only mode for
        // others.
        roles: ['super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff'],
      },
      {
        label: 'Submitted Expenses',
        href: '/expenses',
        icon: Receipt,
        roles: ['super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff'],
      },
    ],
  },
  {
    // Firm-wide AR / AP / payroll surfaces. Hidden from staff / managers /
    // partners by default — they don't need to see the company's vendor
    // bill queue or the firmwide invoice list to do their jobs. Partners
    // still see their own projects' invoices via the project detail page's
    // Invoices tab; admins use this group for the firm-wide view.
    id: 'inputs-company',
    label: 'Company Inputs',
    items: [
      {
        // Parenthetical "(Receivables)" disambiguates against the
        // Reports → Receivables aging view: this is the working
        // invoice list (draft → sent → paid), the Reports entry is
        // the AR aging surface. Same noun, different surface.
        label: 'Invoices (Receivables)',
        href: '/invoices',
        icon: FileText,
        // Partners + managers retained for firm-wide AR visibility — they
        // can scan all projects' invoices in one place rather than hopping
        // project-by-project.
        roles: ['super_admin', 'admin', 'partner', 'associate_partner', 'manager'],
      },
      {
        // Parenthetical mirrors the Invoices entry above — this is the
        // AP working list (pending review → approved → scheduled →
        // paid), distinct from the Reports → Payables aging view.
        label: 'Bills (Payables)',
        href: '/bills',
        icon: CircleDollarSign,
        roles: ['super_admin', 'admin'],
      },
      {
        label: 'Pay runs',
        href: '/payroll',
        icon: Banknote,
        roles: ['super_admin', 'admin'],
      },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      {
        label: 'Rate card',
        href: '/admin/rate-card',
        icon: ScrollText,
        roles: ['super_admin'],
      },
      {
        label: 'Approval policies',
        href: '/admin/approval-policies',
        icon: Shield,
        roles: ['super_admin'],
      },
      {
        label: 'Integrations',
        href: '/admin/integrations',
        icon: Plug,
        roles: ['super_admin', 'admin'],
      },
      {
        // Access matrix — live view of who can do what across the
        // platform. Sources from the same CAPABILITY_ROLES + NAV_GROUPS
        // configs that gate every action, so the table can never
        // drift from runtime. Admin-visible so the operations seat
        // can audit role grants without grepping code.
        label: 'Access matrix',
        href: '/admin/access',
        icon: KeyRound,
        roles: ['super_admin', 'admin'],
      },
      {
        // Business-continuity exports — scheduled snapshots of the
        // critical operating tables to SharePoint, so the team can
        // keep working in Excel during an outage. Admin-visible
        // because the export bundle includes financial + project
        // data + a fully-traceable audit row for every run.
        label: 'Data exports',
        href: '/admin/exports',
        icon: Database,
        roles: ['super_admin', 'admin'],
      },
      {
        // Self-service CSV importers for the office manager. Personnel
        // (upsert by email) + timesheets (bulk pre-approved historical
        // entries). Dry-run preview before the explicit commit click.
        // Label paired with "Data exports" above for visual symmetry.
        label: 'Data imports',
        href: '/admin/import',
        icon: Upload,
        roles: ['super_admin', 'admin'],
      },
      // Agents surface: ships with TASK-080 onward. Hidden from nav until then.
      {
        label: 'Audit log',
        href: '/admin/audit',
        icon: Sparkles,
        roles: ['super_admin'],
      },
      {
        // At-a-glance health of every integration + core service.
        // Sources from the same SystemHealth helper the /healthz
        // endpoint uses, so monitoring + UI never drift apart.
        label: 'System status',
        href: '/system-status',
        icon: Database,
        roles: ['super_admin', 'admin'],
      },
    ],
  },
];

export function isItemVisible(
  item: NavItem,
  roles: readonly Role[],
  band?: Band | null,
): boolean {
  if (item.denyBands && band && item.denyBands.includes(band)) return false;
  if (item.roles.length === 0) return true;
  return item.roles.some((r) => roles.includes(r));
}

export function filterNavForRoles(
  roles: readonly Role[],
  band?: Band | null,
): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => isItemVisible(i, roles, band)),
  })).filter((g) => g.items.length > 0);
}
