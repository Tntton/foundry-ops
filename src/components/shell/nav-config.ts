import type { Role } from '@prisma/client';
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
  ShieldAlert,
  PieChart,
  UserSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: readonly Role[]; // empty array = visible to everyone signed-in
  badge?: string;
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
        roles: ['super_admin', 'admin', 'partner'],
      },
      // Manager home + My week role-specific landings: deferred — for MVP
      // everyone lands on /; Projects is the primary work surface.
      {
        label: 'Projects',
        href: '/projects',
        icon: FolderKanban,
        roles: ['super_admin', 'admin', 'partner', 'manager', 'staff'],
      },
      {
        label: 'Approvals',
        href: '/approvals',
        icon: Inbox,
        roles: ['super_admin', 'admin', 'partner', 'manager'],
      },
      {
        label: 'BD pipeline',
        href: '/bd',
        icon: TrendingUp,
        roles: ['super_admin', 'admin', 'partner'],
      },
      {
        label: 'Risks',
        href: '/risks',
        icon: ShieldAlert,
        roles: ['super_admin', 'admin', 'partner'],
      },
      {
        label: 'Directory',
        href: '/directory',
        icon: Users,
        roles: ['super_admin', 'admin', 'partner'],
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
        roles: ['super_admin', 'admin', 'partner'],
      },
      {
        label: 'Budget watch',
        href: '/budget-watch',
        icon: Shield,
        roles: ['super_admin', 'admin', 'partner'],
      },
      {
        label: 'AR aging',
        href: '/ar',
        icon: HandCoins,
        roles: ['super_admin', 'admin', 'partner'],
      },
      {
        label: 'AP aging',
        href: '/ap',
        icon: Wallet,
        roles: ['super_admin', 'admin'],
      },
      {
        label: 'Cash flow',
        href: '/cashflow',
        icon: LineChart,
        roles: ['super_admin', 'admin', 'partner'],
      },
      {
        label: 'Utilisation',
        href: '/utilisation',
        icon: Gauge,
        roles: ['super_admin', 'admin', 'partner'],
      },
      {
        label: 'Client concentration',
        href: '/concentration',
        icon: PieChart,
        roles: ['super_admin', 'admin', 'partner'],
      },
      {
        label: 'Partner scorecard',
        href: '/partners',
        icon: UserSquare,
        roles: ['super_admin', 'admin', 'partner'],
      },
    ],
  },
  {
    id: 'inputs',
    label: 'Inputs',
    items: [
      {
        label: 'Timesheet',
        href: '/timesheet',
        icon: Clock,
        roles: ['super_admin', 'admin', 'partner', 'manager', 'staff'],
      },
      {
        label: 'Expenses',
        href: '/expenses',
        icon: Receipt,
        roles: ['super_admin', 'admin', 'partner', 'manager', 'staff'],
      },
      {
        label: 'Invoices',
        href: '/invoices',
        icon: FileText,
        roles: ['super_admin', 'admin', 'partner', 'manager'],
      },
      {
        label: 'Bills',
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
      // Agents surface: ships with TASK-080 onward. Hidden from nav until then.
      {
        label: 'Audit log',
        href: '/admin/audit',
        icon: Sparkles,
        roles: ['super_admin'],
      },
    ],
  },
];

export function isItemVisible(item: NavItem, roles: readonly Role[]): boolean {
  if (item.roles.length === 0) return true;
  return item.roles.some((r) => roles.includes(r));
}

export function filterNavForRoles(roles: readonly Role[]): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => isItemVisible(i, roles)),
  })).filter((g) => g.items.length > 0);
}
