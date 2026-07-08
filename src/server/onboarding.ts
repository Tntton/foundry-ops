import type { Role } from '@prisma/client';

/**
 * Role-scoped onboarding content shown on first sign-in. Each role
 * profile is a set of slides: a shared "Welcome" opener, 2-3 role-
 * specific middle slides, and a shared "You're set" closer.
 *
 * Highest-privilege role wins when someone has multiple (e.g. a
 * super_admin who is also a partner sees the super_admin path). The
 * ordering in TIER matches the org hierarchy: super_admin > admin >
 * partner > associate_partner > manager > staff.
 */

export type OnboardingSlide = {
  title: string;
  body: string;
  /** Optional list of "here's where to go" links (relative URLs). */
  links?: Array<{ label: string; href: string }>;
};

export type OnboardingProfile = {
  role: string;
  slides: OnboardingSlide[];
};

const ROLE_TIER: Role[] = [
  'super_admin',
  'admin',
  'partner',
  'associate_partner',
  'manager',
  'staff',
];

export function resolvePrimaryRole(roles: readonly Role[]): Role {
  for (const r of ROLE_TIER) {
    if (roles.includes(r)) return r;
  }
  return 'staff';
}

function opener(firstName: string): OnboardingSlide {
  return {
    title: `Welcome to Foundry Ops, ${firstName}.`,
    body: 'This is where we run the firm day-to-day. Timesheet, expenses, projects, approvals, integrations. Everything you do here is auditable and rolls into the firm P&L. A quick tour, then you are on your way.',
  };
}

const CLOSER: OnboardingSlide = {
  title: 'You are set.',
  body: 'The floating pill on the bottom-right is the in-app assistant. Ask it what is on your plate, what you have logged this week, or which screen does X. Feedback and bug reports go through the smaller pill next to it.',
};

function slidesFor(role: Role): OnboardingSlide[] {
  switch (role) {
    case 'super_admin':
    case 'admin':
      return [
        {
          title: 'The dashboard is your triage view.',
          body: 'Anything pending your action is grouped there: approvals awaiting a decision, projects going stale, invoices ready to draft, expenses over threshold. Cards you dismiss stay dismissed until the underlying state changes.',
          links: [
            { label: 'Dashboard', href: '/' },
            { label: 'Firm P&L', href: '/pnl' },
          ],
        },
        {
          title: 'Directory is the identity master.',
          body: 'Every person, client, and contractor lives here. Adding someone provisions their M365 account and Entra group membership drives their role. Rate card, expert rate, and agency markup all sit on their profile.',
          links: [
            { label: 'Team directory', href: '/directory' },
            { label: 'Rate card', href: '/admin/rate-card' },
          ],
        },
        {
          title: 'Integrations, feedback, feature flags.',
          body: 'Xero, DocuSign, WhatsApp, SharePoint, M365 all live under Admin. Feedback triage picks up bug reports and feature requests logged from the floating pill. Feature flags gate anything not yet ready for the whole firm.',
          links: [
            { label: 'Integrations', href: '/admin/integrations' },
            { label: 'Feedback', href: '/admin/feedback' },
          ],
        },
      ];
    case 'partner':
    case 'associate_partner':
      return [
        {
          title: 'Your dashboard is BD-first.',
          body: 'Pipeline, deals, invoices ready to send, approvals waiting on your sign-off. The partner scorecard has your revenue, hours, and portfolio at a glance.',
          links: [
            { label: 'Dashboard', href: '/' },
            { label: 'BD pipeline', href: '/bd' },
            { label: 'Scorecard', href: '/partners' },
          ],
        },
        {
          title: 'Projects, teams, and delivery.',
          body: 'Every engagement you own lives under Projects. Add team members, edit the contract value, run through the tracker, and archive when done. Team hours roll straight into project cost.',
          links: [
            { label: 'Projects', href: '/projects' },
          ],
        },
        {
          title: 'Approvals over $20k need MFA.',
          body: 'High-value invoices, bills, and expense approvals require a second factor. WhatsApp approvals are supported for anything under the threshold; the web app is required above it.',
          links: [
            { label: 'My approvals', href: '/approvals' },
          ],
        },
      ];
    case 'manager':
      return [
        {
          title: 'Your dashboard groups the work.',
          body: 'Approvals for your team, projects you are managing, and any actions waiting on you. The kanban view on Projects gives you a per-stage picture.',
          links: [
            { label: 'Dashboard', href: '/' },
            { label: 'Projects', href: '/projects' },
          ],
        },
        {
          title: 'Resource planning is where you allocate.',
          body: 'The bandwidth heatmap shows who is under- and over-loaded across the coming weeks. Drag allocations, edit team membership, and forecast against the pyramid baseline.',
          links: [
            { label: 'Resource planning', href: '/resource-planning' },
            { label: 'My approvals', href: '/approvals' },
          ],
        },
        {
          title: 'Timesheet weekly, expenses as they hit.',
          body: 'Fill in your own timesheet weekly and approve your team submissions as they come in. Contractor invoices arrive via email or WhatsApp and route to you for approval when they are on your project.',
          links: [
            { label: 'My timesheet', href: '/timesheet' },
            { label: 'My expenses', href: '/expenses' },
          ],
        },
      ];
    case 'staff':
    default:
      return [
        {
          title: 'The dashboard shows what needs you.',
          body: 'Timesheet due, expenses to file, updates from your team. Everything is one click away. The nav on the left is your full toolbox.',
          links: [
            { label: 'Dashboard', href: '/' },
          ],
        },
        {
          title: 'Log your time weekly.',
          body: 'Timesheet by day and project. The regular-days feature pre-fills your standard week so you only edit exceptions. Your manager approves what you submit.',
          links: [
            { label: 'My timesheet', href: '/timesheet' },
          ],
        },
        {
          title: 'Expenses go through the receipt agent.',
          body: 'Take a photo, upload it, or forward the receipt to finance@foundry.health. The extraction fills in the fields, you check them, and it routes to your manager. WhatsApp works too, same address book.',
          links: [
            { label: 'File expense', href: '/expenses/new' },
            { label: 'My expenses', href: '/expenses' },
          ],
        },
      ];
  }
}

export function onboardingFor(
  role: Role,
  firstName: string,
): OnboardingProfile {
  return {
    role,
    slides: [opener(firstName), ...slidesFor(role), CLOSER],
  };
}
