# TASKS.md — Foundry Ops

Ralph-sized atomic tasks. Work top to bottom. Pick the first `status: todo`. Dependencies listed inline. Update status + note on completion. Add new tasks at the bottom of the relevant phase if you discover them — never silently expand scope.

**Status values:** `todo`, `doing`, `blocked`, `done`, `deferred` (out of current MVP scope; do not auto-pick up in the ralph loop).

**Convention:** commit message format is `feat(TASK-NNN): <short description>` or `chore(TASK-NNN): ...` or `fix(TASK-NNN): ...`.

---

## Phase 0 — Foundation

### TASK-000 — Propagate domain correction (`foundryhealth.com.au` → `foundry.health`)
**status:** done
**depends on:** —
**acceptance:**
- [x] All occurrences of `foundryhealth.com.au` in `CLAUDE.md`, `HANDOFF.md`, `AGENTS.md`, `INTEGRATIONS.md`, `TASKS.md` replaced with `foundry.health`
- [x] Prototype .jsx files (`screens-7.jsx`, `screens-auth.jsx`, `screens-directory-people.jsx`, `screens-integrations-agents.jsx`) updated so future porting uses the correct domain
- [x] Email aliases kept at existing local parts (`bills@`, `receipts@`, `accounts@`) — domain only swapped. **OPEN:** confirm whether `finance@foundry.health` is the canonical accounts mailbox or whether `bills@`, `receipts@`, `accounts@` are separate shared mailboxes — affects Graph subscription setup in TASK-046/TASK-093.
- [x] `grep -r "foundryhealth.com.au" --exclude=TASKS.md` returns zero matches (TASK-000 self-references the old domain in its description, which is expected)
- [x] Commit: `chore(TASK-000): correct domain foundryhealth.com.au → foundry.health`

**context:** Confirmed by user 2026-04-19 — Foundry does not own `foundryhealth.com.au`; the real domain is `foundry.health`. All Entra tenant restrictions, auth allowlists, email routing, SharePoint URLs, and webhook hosts must use `foundry.health`.

**note on completion:** 9 files updated; screens-auth.jsx line 49 collapsed the dual-domain check to a single `@foundry.health` check. Mailbox canonicalisation (finance@ vs bills@/receipts@/accounts@) left open for TASK-046/093 blocker resolution.

### TASK-001 — Repo scaffolding
**status:** done
**depends on:** —
**acceptance:**
- [x] Next.js 14 app router, TypeScript strict (Next 14.2.15; strict + noUncheckedIndexedAccess + noImplicitOverride + noFallthroughCasesInSwitch + forceConsistentCasingInFileNames)
- [x] ESLint + Prettier + Vitest installed and configured (ESLint 8 with `eslint-config-next` + `@typescript-eslint`; Prettier 3; Vitest 2.1 with `src/**/*.{test,spec}.{ts,tsx}`)
- [x] `pnpm typecheck`, `pnpm test`, `pnpm lint` all exit 0 on empty project (verified locally with a smoke test at `src/__tests__/smoke.test.ts`)
- [x] GitHub Actions: typecheck + test + lint + prisma validate on every push (`.github/workflows/ci.yml`, Node 22, pnpm 9.12, `--frozen-lockfile`)
- [x] `README.md` in the repo root references this handoff bundle (dev-setup section added on top; handoff-bundle content preserved below)

**note on completion:** `prisma/schema.prisma` was copied verbatim from the root `schema.prisma` ahead of TASK-002 so CI's `prisma validate` step passes from day one. TASK-002 should either (a) drop the root copy in favour of `prisma/schema.prisma`, or (b) add a CI check that the two remain byte-identical — current state risks drift. `prisma:validate` script injects a placeholder `DATABASE_URL` since Prisma 5 resolves env vars even for validate-only. `.eslintrc.json` had to explicitly declare `@typescript-eslint` plugin + parser (eslint-config-next's auto-detection wasn't activating the rule).

### TASK-002 — Postgres + Prisma setup
**status:** todo
**depends on:** TASK-001
**acceptance:**
- [x] `prisma/schema.prisma` copied from this bundle (verbatim) — done in TASK-001 to unblock CI prisma validate; root `schema.prisma` remains as the handoff snapshot while `prisma/schema.prisma` becomes the living working copy
- [ ] `pnpm prisma migrate dev --name init` succeeds against the Supabase DB (not local Docker — see context below)
- [ ] `pnpm prisma generate` runs in `postinstall`
- [ ] ~~Docker compose (or devcontainer) provides local Postgres~~ — **dropped per user 2026-04-19; use hosted Supabase instead**
- [ ] `.env.example` documents `DATABASE_URL` (pooled / pgbouncer-compatible for app runtime) and `DIRECT_URL` (direct connection for migrations) with Supabase URL patterns
- [ ] `src/server/db.ts` exports a singleton `PrismaClient` with the standard Next.js HMR-safe pattern

**context:** Per user 2026-04-19, Supabase is the sole Postgres host — no local Docker. Implication: `prisma migrate dev` will land migrations directly on the Supabase DB from day one. This is acceptable during the MVP testing phase (TT + JN parallel-run); once real client data lands, schema changes should shift to a review/deploy flow rather than `migrate dev`. TASK-002 will wait on the user providing the Supabase project's connection strings (DATABASE_URL pooler + DIRECT_URL non-pooler).

### TASK-003 — Tailwind theme from design tokens
**status:** todo
**depends on:** TASK-001
**acceptance:**
- [ ] Design tokens from `hifi.css` extracted into `tailwind.config.ts` (colors, spacing, radii, shadows, typography)
- [ ] Brand primary (`#D97757`) aliased to `brand`
- [ ] Status colors (green/amber/red) aliased
- [ ] A single `tokens.test.ts` spot-checks a few values
- [ ] shadcn/ui installed; Button + Input + Badge primitives added, themed

### TASK-004 — NextAuth with Entra ID, tenant-restricted
**status:** todo
**depends on:** TASK-002
**acceptance:**
- [ ] NextAuth configured with Entra ID provider
- [ ] Tenant ID pinned to Foundry's (env var)
- [ ] Non-`@foundry.health` emails rejected at callback
- [ ] Contractor magic-link flow (email → one-time token, 15-min TTL, stored hashed)
- [ ] On successful sign-in, upsert `Person` row (match by email)
- [ ] Session cookie: httpOnly, secure, sameSite=lax

### TASK-005 — Session → roles middleware
**status:** todo
**depends on:** TASK-004
**acceptance:**
- [ ] `getSession()` helper returns `{person, roles: Role[]}` or null
- [ ] Roles resolved from Entra group membership on sign-in; cached on Person for 1h
- [ ] Five roles supported: `super_admin`, `admin`, `partner`, `manager`, `staff`
- [ ] Person can hold multiple roles — roles is an array
- [ ] Unit test: person in `FoundryPartners` group resolves to `partner`

### TASK-006 — Permission primitive
**status:** todo
**depends on:** TASK-005
**acceptance:**
- [ ] `requireCapability(session, capability: Capability)` throws `UnauthorizedError` if missing
- [ ] `hasCapability(session, capability)` returns boolean (non-throwing)
- [ ] Capability catalog matches `HANDOFF.md §1.2` — at minimum: `invoice.approve.over_20k`, `invoice.approve.under_20k`, `expense.approve.over_2k`, `expense.approve.under_2k`, `payrun.approve`, `project.create`, `person.create`, `ratecard.edit`, `integration.manage`, `agent.run_manual`, `auditlog.view`
- [ ] Capability → required-role mapping is a single const table
- [ ] Unit tests cover: Super Admin has all; Staff has effectively none; Manager can approve expenses on own project only

### TASK-007 — Audit event writer
**status:** todo
**depends on:** TASK-002
**acceptance:**
- [ ] `writeAudit(tx, {actor, action, entity, delta, source})` accepts a Prisma tx
- [ ] Audit row written in same transaction as the mutation (test proves rollback cleans both)
- [ ] Delta stored as jsonb diff (use `deep-diff` or similar)
- [ ] Source enum: `web | agent | api | integration_sync`
- [ ] `/api/admin/audit` route: list + filter by actor, entity, date range (Super Admin only)

### TASK-008 — Port prototype UI primitives
**status:** todo
**depends on:** TASK-003
**acceptance:**
- [ ] `Button`, `Badge`, `Icon`, `Avatar`, `KPI`, `Card`, `Table`, `Drawer`, `Modal`, `Tabs` components in `src/components/ui/`
- [ ] Each has a Storybook or dev-only playground entry
- [ ] Visual spot-check against `screenshots/01-dashboard-super-admin.png` for density and spacing
- [ ] Icon component uses lucide-react (or equivalent), not inline SVG strings

### TASK-009 — Shell: sidebar + topbar + breadcrumb
**status:** todo
**depends on:** TASK-008, TASK-005
**acceptance:**
- [ ] Sidebar groups: Workspace / Inputs / System (match prototype)
- [ ] Role-filtered nav (hide Projects for Staff outside their projects, hide P&L for Manager, etc.)
- [ ] Topbar: breadcrumb + search placeholder + avatar menu
- [ ] No top-right role switcher (that's prototype-only)
- [ ] Keyboard nav: `⌘K` opens a placeholder command palette (phase 2)

### TASK-010 — Healthz + staging deploy
**status:** todo
**depends on:** TASK-004
**acceptance:**
- [ ] `/healthz` returns `{ok, db:'up'|'down', version}` — no auth required
- [ ] Staging deployed (Vercel or equivalent), env vars set
- [ ] A Foundry staff account can sign in on staging
- [ ] Audit log shows the sign-in event

---

## Phase 1A — Identity & config

### TASK-020 — Seed script from fixtures
**status:** todo
**depends on:** TASK-002
**acceptance:**
- [ ] `prisma/seed.ts` reads a checked-in JSON derived from `foundry-team.jsx` (emit it to `prisma/fixtures/team.json` as part of this task)
- [ ] Rate card seeded from `foundry-ratecard.jsx`
- [ ] Only for dev/staging — never runs in production (env guard)
- [ ] `pnpm db:reset` = drop + migrate + seed

### TASK-021 — Directory screen: list
**status:** todo
**depends on:** TASK-009, TASK-020
**acceptance:**
- [ ] `/directory` tabs: People, Clients, Contractors, Suppliers
- [ ] People tab: table with initials, name, band, level, rate, fte, region, employment, active
- [ ] Search + filters (band, region, employment)
- [ ] Empty / loading / error states
- [ ] Permission: Partner sees read-only; Admin+ sees edit affordance; Staff can't reach route

### TASK-022 — Person detail drawer
**status:** todo
**depends on:** TASK-021
**acceptance:**
- [ ] Right-side drawer (~640px), tabbed: Profile, Employment, Pay, Integrations
- [ ] Pay tab: rate (visible to Super Admin / Admin only)
- [ ] Integrations tab: M365 link, Xero contact ID (if contractor)
- [ ] Edit requires explicit Save; dirty state blocks navigation with confirm
- [ ] Writes `AuditEvent` on save

### TASK-023 — New Person wizard
**status:** todo
**depends on:** TASK-022
**acceptance:**
- [ ] Multi-step sidebar: Basics → Employment → Pay → Permissions → Review
- [ ] On finish: creates `Person`, queues M365 provisioning job, sends welcome email
- [ ] Provisioning job is idempotent (re-runnable if it fails partway)
- [ ] For contractors: creates Xero contact instead of M365 account
- [ ] Flag-gated (`ENABLE_PROVISIONING`) — default off in dev, on in staging

### TASK-024 — Client list + detail drawer
**status:** todo
**depends on:** TASK-009
**acceptance:**
- [ ] `/directory?tab=clients`: table with code, legal name, trading name, primary partner, active projects count, AR total
- [ ] Drawer: details, billing, primary partner, active projects, AR aging sparkline
- [ ] Permission: Partner+ can see, Admin+ can edit

### TASK-025 — New Client wizard
**status:** todo
**depends on:** TASK-024
**acceptance:**
- [ ] Fields: code (uniqueness enforced), legal name, trading name, ABN (validated), billing address, billing email, primary partner, payment terms
- [ ] On finish: creates Client + Xero contact (via Xero integration if enabled, stub otherwise)
- [ ] Writes `AuditEvent`

### TASK-026 — Rate card view + edit
**status:** todo
**depends on:** TASK-020
**acceptance:**
- [ ] `/admin/rate-card` — Super Admin only
- [ ] Table: role_code, effective_from, cost_rate, bill_rate_low, bill_rate_high
- [ ] Edit creates a new versioned row (never mutates existing)
- [ ] Audit event on every change
- [ ] "Active as of <date>" selector shows historical rate cards

---

## Phase 1B — Project lifecycle

### TASK-030 — New Project wizard (core fields)
**status:** todo
**depends on:** TASK-024
**acceptance:**
- [ ] Sidebar: Basics → Team → Milestones → Review
- [ ] Basics: code (unique), client, name, description, contract value, start, end, primary partner, manager
- [ ] Team: add people with role_on_project + allocation_pct
- [ ] Milestones: label, due, amount, status
- [ ] Creates `Project` + commits all in one transaction
- [ ] Permission: Admin+ or Partner (creating own)

### TASK-031 — Project SharePoint folder provision
**status:** todo
**depends on:** TASK-030
**acceptance:**
- [ ] On project create, queue a job that creates folder structure under `/Clients/<ClientCode>/<ProjectCode>/` with subfolders: `01 Brief`, `02 Working`, `03 Delivery`, `04 Admin`
- [ ] `sharepoint_folder_url` written back to Project
- [ ] Idempotent (skips if folder exists)
- [ ] Failure marks project with `provisioning_error` flag; retry button in UI

### TASK-032 — Xero tracking category per project
**status:** todo
**depends on:** TASK-030, TASK-050
**acceptance:**
- [ ] On project create, ensure a tracking category value exists for the project code
- [ ] `xero_tracking_category_value` written back
- [ ] Reuses category "Projects" — creates the value, not the category

### TASK-033 — Projects list
**status:** todo
**depends on:** TASK-030
**acceptance:**
- [ ] `/projects` list: code, client, name, stage, primary partner, manager, contract value, actual spend, margin
- [ ] Filters: stage, partner, client, active/archived
- [ ] Role-scoped: Manager sees projects where they're manager; Staff sees projects they're on
- [ ] Empty / loading / error states

### TASK-034 — Project detail: Brief tab
**status:** todo
**depends on:** TASK-033
**acceptance:**
- [ ] `/projects/[code]` with tabs: Brief, Team, Milestones, P&L, Files, Settings, Risks
- [ ] Brief: description, contract, dates, SharePoint link, Xero link
- [ ] Edit gated to Admin+ / owning Partner / owning Manager

### TASK-035 — Project detail: Team tab
**status:** todo
**depends on:** TASK-034
**acceptance:**
- [ ] Add/remove people with role_on_project + allocation_pct
- [ ] Shows utilisation conflicts (person already >100% in this period)
- [ ] Audit event on change

### TASK-036 — Project detail: Milestones tab
**status:** todo
**depends on:** TASK-034
**acceptance:**
- [ ] CRUD milestones: label, due, amount, status (not_started / in_progress / delivered / invoiced)
- [ ] Milestone → invoice link visible once invoiced
- [ ] Totals validate against contract_value (warn if sum > contract)

### TASK-037 — Project detail: P&L tab
**status:** todo
**depends on:** TASK-034
**acceptance:**
- [ ] Revenue (invoiced + WIP) vs cost (timesheet × cost_rate + expenses) vs margin
- [ ] Stacked bar by month
- [ ] Permission: Super Admin / Admin / owning Partner / owning Manager

### TASK-038 — Project detail: Files tab
**status:** todo
**depends on:** TASK-034, TASK-031
**acceptance:**
- [ ] Lists recent files from SharePoint folder (via Graph)
- [ ] "Open in SharePoint" link for each
- [ ] Upload button opens SharePoint in new tab (we don't handle binaries)

### TASK-039 — Project detail: Settings + Risks tabs
**status:** todo
**depends on:** TASK-034
**acceptance:**
- [ ] Settings: stage, dates, partner, manager, billing freq, reporting period
- [ ] Risks: CRUD rows (title, owner, severity, status, mitigation)

---

## Phase 1C — Transactional flows

### TASK-040 — Timesheet: week grid
**status:** todo
**depends on:** TASK-033
**acceptance:**
- [ ] `/timesheet` week view: rows = projects × tasks, cols = 7 days, cells = hours
- [ ] Add-row: project picker (only projects person is on)
- [ ] Save draft + Submit for approval
- [ ] Validation: max 24h/day, no negative, description required if >0h

### TASK-041 — Timesheet: approval
**status:** todo
**depends on:** TASK-040
**acceptance:**
- [ ] Submitted rows appear in Approvals queue for project manager
- [ ] Approve → status `approved`; Reject → back to draft with note
- [ ] Approved entries are billable (eligible for invoice drafter)

### TASK-042 — Expense: submit
**status:** todo
**depends on:** TASK-021
**acceptance:**
- [ ] `/expenses/new`: fields per `schema.prisma` Expense entity
- [ ] Receipt upload → SharePoint `/Expenses/<PersonCode>/<YYYY>-<MM>/`
- [ ] GST auto-calculated (10%) with manual override
- [ ] Category picker from enum
- [ ] Project optional (OPEX if blank)

### TASK-043 — Expense: approval + reimburse queue
**status:** todo
**depends on:** TASK-042
**acceptance:**
- [ ] Threshold routing: ≤$2k → Admin or owning Manager; >$2k → Super Admin
- [ ] Approved expenses queue for reimbursement (batched into pay run)
- [ ] Rejected → back with note

### TASK-044 — Invoice: draft (manual)
**status:** todo
**depends on:** TASK-036, TASK-041
**acceptance:**
- [ ] `/invoices/new` against a project
- [ ] Line items: milestone or T&M (pulls approved timesheet entries at bill rate)
- [ ] Auto-calculates GST + total
- [ ] Save as draft; submit for approval

### TASK-045 — Invoice: approval + send
**status:** todo
**depends on:** TASK-044
**acceptance:**
- [ ] Approval routing: ≤$20k → owning Partner or Admin; >$20k → Super Admin
- [ ] Approve → push to Xero as draft
- [ ] Send button available after approve — sends via Xero
- [ ] Status webhook from Xero updates paid_at + payment_received_amount

### TASK-046 — Bill (AP): upload + draft
**status:** todo
**depends on:** TASK-020
**acceptance:**
- [ ] `/bills/new`: upload PDF/image + fill fields
- [ ] Attachment → SharePoint `/AP/<YYYY>/<MM>/`
- [ ] Supplier picker (auto-create Person-as-supplier or Organisation)
- [ ] Status `pending_review`

### TASK-047 — Bill: approval + push to Xero
**status:** todo
**depends on:** TASK-046
**acceptance:**
- [ ] Super Admin approval required (per A8 default)
- [ ] Approve → push to Xero as Bill (draft)
- [ ] Xero webhook updates paid status

---

## Phase 1D — Approvals

### TASK-048 — Approvals queue UI
**status:** todo
**depends on:** TASK-045, TASK-047, TASK-043, TASK-041
**acceptance:**
- [ ] `/approvals` list of all pending `Approval` rows for the current user
- [ ] Filter by type (invoice, expense, bill, pay run, contract, hire, rate change)
- [ ] Row → detail modal with full context + approve / reject actions
- [ ] Decision note required on reject
- [ ] Approved / rejected rows disappear from queue

### TASK-049 — Approvals: threshold config UI
**status:** todo
**depends on:** TASK-048
**acceptance:**
- [ ] `/admin/approval-policies` (Super Admin only)
- [ ] Edit invoice / expense / pay run thresholds; which role required
- [ ] Audit event on change
- [ ] Thresholds fetched server-side per request (no hard-coding)

---

## Phase 1E — Xero integration

### TASK-050 — Xero OAuth connect
**status:** todo
**depends on:** TASK-010
**acceptance:**
- [ ] `/admin/integrations/xero` connect button → OAuth dance
- [ ] Access + refresh tokens stored encrypted
- [ ] Disconnect button
- [ ] Webhook signature verification middleware

### TASK-051 — Xero: contact sync
**status:** todo
**depends on:** TASK-050, TASK-024
**acceptance:**
- [ ] On Client create/edit: upsert Xero contact, store `xero_contact_id`
- [ ] Contractor Person rows also sync as contacts
- [ ] Nightly reconciliation job finds drift

### TASK-052 — Xero: tracking category sync
**status:** todo
**depends on:** TASK-050, TASK-030
**acceptance:**
- [ ] On project create: ensure tracking category value exists
- [ ] Nightly: list Xero tracking categories, warn on orphans

### TASK-053 — Xero: invoice push + status webhook
**status:** todo
**depends on:** TASK-045
**acceptance:**
- [ ] On invoice approve: push to Xero as draft invoice with line items + tracking
- [ ] Webhook updates status (`authorised`, `paid`, `voided`) + paid_at
- [ ] Conflict flag raised if Xero invoice is edited after push

### TASK-054 — Xero: bill push + status webhook
**status:** todo
**depends on:** TASK-047
**acceptance:**
- [ ] On bill approve: push as Xero Bill (draft)
- [ ] Webhook updates paid status

### TASK-055 — Xero: nightly bank-feed pull
**status:** todo
**depends on:** TASK-050
**acceptance:**
- [ ] Nightly job stores raw bank transactions in `BankTransaction` table
- [ ] Idempotent on Xero transaction ID
- [ ] Used later by Xero Reconciler agent (TASK-083)

---

## Phase 1F — Excel exports

### TASK-060 — Excel export infra
**status:** todo
**depends on:** TASK-050
**acceptance:**
- [ ] Job writes .xlsx to SharePoint path `/Reports/<WorkbookName>.xlsx`
- [ ] Overwrites atomically (upload + rename)
- [ ] Uses ExcelJS or equivalent — no proprietary template

### TASK-061 — Workbook: Finance.xlsx
**status:** todo
**depends on:** TASK-060
**acceptance:**
- [ ] Sheets: P&L, Cash, AR aging, AP aging
- [ ] Nightly + on-demand "regenerate" button on admin screen

### TASK-062 — Workbook: Timesheet.xlsx
**status:** todo
**depends on:** TASK-060
**acceptance:**
- [ ] Sheets: by person, by project, utilisation
- [ ] Covers current FY + last FY

### TASK-063 — Workbook: Invoices.xlsx
**status:** todo
**depends on:** TASK-060

### TASK-064 — Workbook: Expenses.xlsx
**status:** todo
**depends on:** TASK-060

### TASK-065 — Workbook: Pipeline.xlsx
**status:** todo
**depends on:** TASK-060

### TASK-066 — Workbook: Partner-pool.xlsx
**status:** todo
**depends on:** TASK-060

### TASK-067 — Remove "2-way synced" language
**status:** todo
**depends on:** TASK-060
**acceptance:**
- [ ] Sidebar + relevant screens say "Snapshot · regenerate" not "synced"
- [ ] Last-snapshot timestamp visible

---

## Phase 2 — Firm intelligence

> **Deferred from MVP (scope cut confirmed 2026-04-19).** MVP = Phases 0 + 1 only, for parallel-run testing from 2026-04-24. Phase 2 tasks remain fully specified below and should be picked up once the MVP is in TT/JN's hands and steady-state. The ralph loop should not enter Phase 2 automatically — user will flip individual statuses back to `todo` when ready.

### TASK-070 — Firm dashboard (Super Admin / Partner views)
**status:** deferred
**depends on:** TASK-048, TASK-053
**acceptance:**
- [ ] `/dashboard`: KPIs + section grid (cash, AR aging, utilisation, partner pool, BD pipeline, milestones due)
- [ ] Section layout persisted per user in `UserPreference`

### TASK-071 — P&L overview
**status:** deferred
**depends on:** TASK-055, TASK-044, TASK-046
**acceptance:**
- [ ] `/pnl`: revenue / cost / margin by month
- [ ] Waterfall chart for selected period
- [ ] Drill-down to project

### TASK-072 — Forecast sandbox
**status:** deferred
**depends on:** TASK-071
**acceptance:**
- [ ] Editable what-if overlay: add/remove projects, shift start dates, change rates
- [ ] "Save scenario" persists to `Scenario` table
- [ ] Doesn't touch real project data

### TASK-073 — Cost planning + OPEX
**status:** deferred
**depends on:** TASK-071
**acceptance:**
- [ ] `/costplan`: OPEX lines with category, vendor, amount monthly, start/end
- [ ] Drawer to edit
- [ ] Rolls into P&L

### TASK-074 — BD pipeline
**status:** deferred
**depends on:** TASK-009
**acceptance:**
- [ ] `/bd`: kanban by stage (lead / qualifying / proposal / negotiation / won / lost)
- [ ] Deal drawer: value, probability, owner, target close, notes
- [ ] Weighted value rolls up per stage

### TASK-075 — Deal → Project conversion
**status:** deferred
**depends on:** TASK-074, TASK-030
**acceptance:**
- [ ] "Convert" action on won deal → prefills New Project wizard
- [ ] `converted_project_id` stored on Deal; can't be undone

### TASK-076 — Resource planning
**status:** deferred
**depends on:** TASK-035
**acceptance:**
- [ ] `/resource`: matrix of people × weeks, cells = allocation %
- [ ] Overallocation flagged red
- [ ] Drag-to-adjust (phase 2 polish; initial = click-to-edit drawer)

### TASK-077 — Partner true-up
**status:** deferred
**depends on:** TASK-071
**acceptance:**
- [ ] `/trueup`: period picker, pool computation (revenue × partner-share rules)
- [ ] Payout rows per partner
- [ ] Approve → generates bill entries for each partner

### TASK-078 — Manager dashboard + Staff "My week"
**status:** deferred
**depends on:** TASK-041
**acceptance:**
- [ ] `/mgrhome`: team utilisation, project health cards
- [ ] `/myweek`: personal utilisation, gaps highlighted

---

## Phase 3A — Agent infrastructure

### TASK-080 — Inngest setup + AgentRun table
**status:** todo
**depends on:** TASK-002
**acceptance:**
- [ ] Inngest installed, local dev server running
- [ ] `AgentRun` rows created on trigger; state machine resumable
- [ ] One example echo-agent proves the loop

### TASK-081 — Prompt versioning + Zod validation loop
**status:** todo
**depends on:** TASK-080
**acceptance:**
- [ ] Prompts live in `src/server/agents/<name>/prompt.ts`, with `version` const
- [ ] `callClaudeWithSchema(prompt, schema)` retries up to 3 times on validation failure, feeding error back into prompt
- [ ] `prompt_version` logged on every `AgentRun`

### TASK-082 — LLM call logger + cost cap
**status:** todo
**depends on:** TASK-081
**acceptance:**
- [ ] Every Claude call logged to `LLMCall` (tokens, latency, cost)
- [ ] Per-run cost cap ($0.20 default); exceeding marks run `awaiting_human`
- [ ] Per-agent monthly cap with alert at 80%

---

## Phase 3B — Agents (ordered by ease of wins)

### TASK-090 — Agent: Receipt parser
**status:** todo
**depends on:** TASK-042, TASK-082
**acceptance:**
- [ ] Trigger: email to `receipts@`, WhatsApp photo, or in-app upload
- [ ] Input: image/PDF → Claude vision extraction
- [ ] Output: Draft `Expense` (vendor, amount, date, GST, category, confidence)
- [ ] Golden-file tests: 5 sample receipts (Australian formats)
- [ ] Confidence < 0.7 → queued as "needs review" not auto-drafted

### TASK-091 — Agent: Timesheet reconciler (advisory)
**status:** todo
**depends on:** TASK-041, TASK-082
**acceptance:**
- [ ] Friday 3pm schedule
- [ ] Input: person's M365 calendar + logged hours
- [ ] Output: in-app notification + optional WhatsApp (later)
- [ ] No approval — advisory only

### TASK-092 — Agent: Xero reconciler
**status:** todo
**depends on:** TASK-055, TASK-082
**acceptance:**
- [ ] Nightly
- [ ] Matches bank transactions to `Expense` / `Invoice` / `Bill`
- [ ] Suggested matches land in Admin's review queue
- [ ] Confirmed matches write `xero_match_id` on the record

### TASK-093 — Agent: AP intake
**status:** todo
**depends on:** TASK-046, TASK-082
**acceptance:**
- [ ] Trigger: email to `bills@foundry.health` (Graph subscription)
- [ ] Output: Draft `Bill` + attachment filed to SharePoint
- [ ] Supplier auto-matched or flagged "new supplier — review"

### TASK-094 — Agent: Invoice drafter
**status:** todo
**depends on:** TASK-044, TASK-082
**acceptance:**
- [ ] Manual ("Generate invoice for IFM001") or month-end schedule
- [ ] Input: project milestones + approved timesheets + rate card
- [ ] Output: Draft `Invoice` + rendered .docx in SharePoint
- [ ] Gated approval: Partner reviews → Super Admin if >$20k

### TASK-095 — Agent: AR chaser
**status:** todo
**depends on:** TASK-053, TASK-082
**acceptance:**
- [ ] Daily scan of Xero AR aging
- [ ] Drafts per-invoice follow-up emails
- [ ] Partner reviews & sends via Outlook (not auto-send)

### TASK-096 — Agent: Contract drafter
**status:** todo
**depends on:** TASK-075, TASK-082, TASK-130
**acceptance:**
- [ ] Deal won → "Draft SOW" button
- [ ] Input: Deal + Client + rate card + 3 similar past SOWs (if any)
- [ ] Output: .docx in SharePoint; DocuSign envelope (not sent)

---

## Phase 4 — Payments & comms

### TASK-100 — ABA generator
**status:** todo
**depends on:** TASK-047, TASK-043
**acceptance:**
- [ ] Builds NAB/CBA/ANZ-flavour ABA (confirm which in BLOCKER)
- [ ] Inputs: approved bills + approved payroll line items + approved contractor payments
- [ ] Output: `.aba` file written to SharePoint; attached to `PayRun`
- [ ] Super Admin approval required to generate

### TASK-110 — pay.com.au integration
**status:** todo
**depends on:** TASK-100
**acceptance:**
- [ ] Upload ABA (manual first, API if available)
- [ ] Webhook / poll marks PayRun `paid`; ripples to bills/payroll

### TASK-120 — WhatsApp Business: outbound templates
**status:** todo
**depends on:** TASK-010
**acceptance:**
- [ ] Meta-approved templates: approval request, timesheet reminder, AR alert, receipt intake instructions
- [ ] Outbound send wired to notification events
- [ ] Recipient number validation against Person record

### TASK-121 — WhatsApp: inbound receipt photo
**status:** todo
**depends on:** TASK-120, TASK-090
**acceptance:**
- [ ] Photo from registered Person number → SharePoint + Receipt Parser trigger
- [ ] Reply with draft expense summary asking confirm

### TASK-122 — WhatsApp: approval reply with MFA
**status:** todo
**depends on:** TASK-120, TASK-048
**acceptance:**
- [ ] `YES` / `NO` / `REVIEW` from registered approver's number
- [ ] For subjects >$20k: 6-digit MFA challenge sent via WhatsApp before accepting
- [ ] Decision written to Approval + audit

### TASK-130 — DocuSign integration
**status:** todo
**depends on:** TASK-010
**acceptance:**
- [ ] OAuth connect; signed webhook verification
- [ ] Create envelope from .docx + recipient
- [ ] Status webhook → update contract signed state

### TASK-140 — Teams notifications
**status:** todo
**depends on:** TASK-050
**acceptance:**
- [ ] Adaptive cards to `#ops` channel on approval events
- [ ] Click-through deep-links back to app

---

## Phase 5 — Polish

### TASK-200 — Remove role switcher (prod)
**status:** todo
**depends on:** TASK-005
**acceptance:**
- [ ] Role switcher only visible when `NODE_ENV !== 'production'` AND `ENABLE_ROLE_SWITCHER=1`
- [ ] Role always read from session

### TASK-201 — UserPreference table + migration
**status:** todo
**depends on:** TASK-009
**acceptance:**
- [ ] Every localStorage key in the prototype has a server counterpart
- [ ] Migration job on first login pulls localStorage → server (client posts once)

### TASK-202 — Empty / loading / error states sweep
**status:** todo
**depends on:** phases 1–2 done
**acceptance:**
- [ ] Every page has all three; a checklist in the PR proves each

### TASK-203 — Runbook
**status:** todo
**depends on:** phase 4 done
**acceptance:**
- [ ] `RUNBOOK.md` in repo: secrets rotation, re-auth integrations, failed-agent replay, webhook replay, backup + restore

---

*End of TASKS.md. Start with TASK-001.*
