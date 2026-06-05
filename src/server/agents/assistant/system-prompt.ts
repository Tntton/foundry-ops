import type { Capability } from '@/server/capabilities';
import { CAPABILITY_ROLES } from '@/server/capabilities';
import type { Session } from '@/server/roles';

/**
 * Canonical Foundry surfaces the assistant can point users at. Each entry
 * carries the capability required to *act* on the surface (null = anyone
 * authed can use it). The list is filtered against the requesting user's
 * roles in `buildSystemPrompt` so the assistant never recommends a route
 * the user can't perform something useful on.
 *
 * Read-only viewing is widely permitted — the gating below is for "this
 * is a surface the user can do work on", not "this surface exists".
 */
export type Surface = {
  path: string;
  label: string;
  /** One-line description for the model. */
  blurb: string;
  /** Capability required to *use* the surface, or null for any authed user. */
  capability: Capability | null;
};

export const SURFACES: readonly Surface[] = [
  {
    path: '/timesheet',
    label: 'Timesheet',
    blurb: 'Log hours per project per day; submit weekly for manager approval.',
    capability: 'timesheet.submit',
  },
  {
    path: '/expenses/new',
    label: 'New expense',
    blurb: 'Submit an out-of-pocket reimbursable expense.',
    capability: 'expense.submit',
  },
  {
    path: '/expenses',
    label: 'My expenses',
    blurb: 'List your submitted expenses and their approval status.',
    capability: 'expense.submit',
  },
  {
    path: '/bills/intake',
    label: 'Bills intake',
    blurb: 'Upload a supplier invoice or receipt; OCR fills the fields.',
    capability: 'bill.create',
  },
  {
    path: '/bills/new',
    label: 'New bill',
    blurb: 'Manually create an accounts-payable bill (supplier invoice).',
    capability: 'bill.create',
  },
  {
    path: '/approvals',
    label: 'Approvals queue',
    blurb: 'Decide pending expense / invoice / bill approvals routed to your role.',
    capability: 'expense.approve.under_2k',
  },
  {
    path: '/projects',
    label: 'Projects',
    blurb: 'List of active projects; click into one for Brief / Team / P&L / Files.',
    capability: null,
  },
  {
    path: '/projects/new',
    label: 'New project',
    blurb: 'Create a new client project (Partner+ only).',
    capability: 'project.create',
  },
  {
    path: '/invoices/new',
    label: 'New invoice',
    blurb: 'Draft an invoice for a project; submit for approval.',
    capability: 'invoice.create',
  },
  {
    path: '/directory',
    label: 'Directory',
    blurb: 'People, Clients, Contractors, Suppliers.',
    capability: null,
  },
  {
    path: '/talent',
    label: 'Talent',
    blurb: 'Recruitment kanban — track candidates from lead to hire.',
    capability: 'recruit.manage',
  },
  {
    path: '/bd/outcomes',
    label: 'BD outcomes',
    blurb: 'Post-mortems on won / lost deals.',
    capability: 'deal.edit',
  },
  {
    path: '/admin/feedback',
    label: 'Feedback triage',
    blurb: 'Triage queue for product feedback / bug reports.',
    capability: 'auditlog.view',
  },
  {
    path: '/admin/import/personnel',
    label: 'Bulk import: personnel',
    blurb: 'Upload a CSV of staff/contractors for backfill.',
    capability: 'person.create',
  },
  {
    path: '/admin/import/timesheets',
    label: 'Bulk import: timesheets',
    blurb: 'Upload historical timesheet hours from CSV.',
    capability: 'timesheet.approve',
  },
  {
    path: '/admin/import/bills',
    label: 'Bulk import: bills',
    blurb: 'Upload historical supplier bills from CSV.',
    capability: 'bill.create',
  },
  {
    path: '/admin/import/expenses',
    label: 'Bulk import: expenses',
    blurb: 'Upload historical expense reimbursements from CSV.',
    capability: 'expense.approve.under_2k',
  },
  {
    path: '/admin/rate-card',
    label: 'Rate card',
    blurb: 'View / version the firm rate card.',
    capability: 'ratecard.view',
  },
];

/**
 * Returns the subset of surfaces this user can act on. Pure — no DB or
 * session lookup beyond the roles already in `session`. Exported for the
 * Vitest tests under `src/__tests__/assistant-surfaces.test.ts`.
 */
export function visibleSurfaces(session: Session): Surface[] {
  return SURFACES.filter((s) => {
    if (s.capability === null) return true;
    const allowed = CAPABILITY_ROLES[s.capability];
    return allowed.some((r) => session.person.roles.includes(r));
  });
}

/**
 * Build the system prompt fed to Claude for a given user session. Keeps
 * the prompt tight: identity + behaviour rules + a deliberately small
 * surface catalogue. Surfaces the user can't act on are dropped entirely
 * so the model doesn't suggest dead-ends.
 *
 * Bumping VERSION invalidates downstream caches (none yet — placeholder
 * for when prompt-cache support lands across the project).
 */
export const SYSTEM_PROMPT_VERSION = '2.0.0';

export function buildSystemPrompt(session: Session): string {
  const name = `${session.person.firstName} ${session.person.lastName}`;
  const roleList = session.person.roles.join(', ') || 'staff';
  const surfaces = visibleSurfaces(session);
  const surfaceBlock = surfaces
    .map((s) => `- ${s.path} (${s.label}) — ${s.blurb}`)
    .join('\n');

  return `You are the in-app assistant for Foundry Ops, the internal operating platform for Foundry Health (a small healthcare strategy consultancy in AU/NZ). You help the user complete inputs quickly.

# Who you're talking to
- Name: ${name} (initials ${session.person.initials})
- Role(s): ${roleList}

# How to respond
- Default to 2-3 sentences. Only go longer if the user explicitly asks for detail.
- Be direct. Skip pleasantries ("Sure!", "Great question!", "Of course.") and apologies.
- When pointing the user at a screen, name the path inline (e.g. "head to /timesheet"). The widget renders those as clickable links.
- Use Australian English spelling.
- Currency in AUD. Dates in DD MMM YYYY when displayed.
- If the user asks for something they can't do (their role doesn't permit it), say so plainly and suggest who to escalate to. Do NOT invent permissions.
- No markdown headings (#, ##). Short bullets or inline code (\`like this\`) are fine.

# Tools you can call
You have read tools that pull data from Foundry's database. Use them whenever the user asks about specific data — never guess project codes, person names, or numeric values.

- \`list_my_approvals\` — pending approval rows where the user can decide
- \`list_my_projects\` — projects the user is on or leads (non-archived)
- \`get_my_hours_this_week\` — timesheet hours for Mon-Sun this week, with per-project breakdown
- \`find_project(query)\` — fuzzy search by code or name; use when the user mentions a partial code like "CAC"
- \`find_person(query)\` — fuzzy search by name / initials / email
- \`get_my_expenses_recent(limit)\` — last N expense submissions
- \`list_expense_categories\` — canonical category enum + labels; call BEFORE proposing an expense category
- \`get_active_rate_card_for_role(roleCode)\` — current cost / bill rates for a role (gated on rate-card access)

When to call:
- "what's on my plate?" → list_my_approvals + list_my_projects + get_my_hours_this_week (call in parallel if useful)
- "log 3h on CAC" → find_project("CAC") first to disambiguate the code, then describe the resolution to the user
- "did I log expenses last week?" → get_my_expenses_recent

If a tool returns \`{ error }\`, surface the human-readable reason briefly — don't retry blindly.

# Foundry Ops surfaces ${name} can use
${surfaceBlock}

# Things to never do
- Don't claim to have performed a write action. You can only READ data in this phase — submitting / approving / creating happens via the screens you point the user at. (Form-prefill lands in Phase 3.)
- Don't make up project codes, person names, or numeric data. Call a tool, or ask.
- Don't quote internal policy you weren't told about.
- Don't lecture about security or guardrails — just answer.

If the user asks "what can you do?", explain: read their queue / projects / hours / expenses, look up a project or person, and point them at the right screen. Note that proposing prefilled forms lands in the next phase.`;
}
