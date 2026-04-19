# BUILD_ORDER.md — Foundry Ops

This is the ordered plan. **Do not jump phases.** If a task in a later phase looks easy, it's still later — early-phase infrastructure is what makes later phases trivial.

Each phase groups tasks in `TASKS.md`. Within a phase, tasks can be done in any dependency-valid order (the task file lists dependencies).

---

## Phase 0 — Foundation (week 1)

**Goal:** empty Next.js app, DB up, CI green, one authenticated route.

- Repo scaffolding (Next.js 14 app router, TS strict, ESLint, Prettier, Vitest)
- Postgres + Prisma setup, first migration from `schema.prisma`
- Auth: NextAuth + Entra ID provider, tenant-restricted, dev magic-link fallback
- Session middleware: resolves Person from Entra ID, attaches roles
- Permission primitive: `requireCapability(session, 'invoice.approve.over_20k')` — throws if missing
- Audit event writer: single helper, same-transaction pattern
- `/healthz` route returning `{ok: true, db: 'up'}`
- CI: typecheck + test + lint + prisma validate on every push
- Port design tokens from `hifi.css` into Tailwind theme

**Exit criteria:** deploy to staging; sign in with a Foundry M365 account; hit `/healthz`; audit log has a sign-in event.

---

## Phase 1 — Operational core (weeks 2–10)

**Goal:** Foundry can run their day-to-day on this app without any agents.

### 1A — Identity & config
- Directory screen (people + clients + contractors)
- Person detail drawer
- New Person wizard (creates Person → triggers M365 provisioning)
- Client detail drawer + New Client wizard
- Rate card view + versioned edit (Super Admin only)

### 1B — Project lifecycle
- New Project wizard (creates Project + SharePoint folder + Xero tracking category)
- Projects list (firm + filtered-by-role views)
- Project detail: Brief, Team, Milestones, P&L, Files, Settings, Risks tabs

### 1C — Transactional flows
- Timesheet (week grid, submit → manager approve → billable)
- Expenses (submit → approve → reimburse-queue)
- Invoices (draft → approve → push to Xero as draft)
- Bills (AP intake upload → approve → push to Xero)

### 1D — Approvals queue
- Central inbox for anyone with approval authority
- Filter by type (invoice, expense, bill, pay run, contract, hire, rate change)
- Approve / reject actions with required decision note
- Threshold logic: invoice >$20k requires Super Admin

### 1E — Xero integration (one-way to start)
- OAuth connect flow
- Contact sync (clients + contractors)
- Tracking categories (one per active project)
- Invoice push (as draft) + status webhook
- Bill push + status webhook
- Nightly bank-feed read (stored for phase 3 reconciler)

### 1F — Excel exports (replace "2-way synced" language)
- Nightly snapshot job: `Finance.xlsx`, `Timesheet.xlsx`, `Invoices.xlsx`, `Expenses.xlsx`, `Pipeline.xlsx`, `Partner-pool.xlsx`
- On-demand "regenerate" button in UI
- File written to SharePoint; app stores pointer

**Exit criteria:** Foundry stops using their old Excel+Xero manual flow for timesheets, expenses, invoices, bills. Everything routes through the app. Xero stays authoritative for accounting, but every record in Xero originated in the app.

---

## Phase 2 — Firm intelligence (weeks 10–18)

**Goal:** the dashboard + P&L views that make the app worth opening daily for partners.

- Firm dashboard (configurable section grid per role)
- Firm P&L overview + waterfall chart
- Forecast sandbox (what-if P&L)
- Cost planning + OPEX tracker
- BD pipeline (deals, kanban, deal drawer)
- Deal → Project conversion
- Resource planning (allocation × capacity matrix)
- Partner true-up (period close, pool computation, payout rows)
- Manager dashboard + Staff "My week"

**Exit criteria:** Partners open the app instead of Excel to check firm health. Partner pool is computed in-app; Xero just records the payout.

---

## Phase 3 — Agents (weeks 14–24, overlaps Phase 2)

**Goal:** take the tedium off Admin and Partners.

### 3A — Agent infrastructure
- Inngest setup (or BullMQ if preferred)
- `AgentRun` table + resumable state machine
- Prompt versioning (prompts in source, `prompt_version` on every run)
- Zod schema validation on every LLM output with retry-with-error-feedback loop
- LLM call logging (Langfuse or own table): input, output, tokens, latency, cost
- Per-run cost cap ($0.20 default)
- Queue surface on Integrations & Agents screen (live, beta, paused states)

### 3B — Agents (ordered by ease of wins)
1. **Receipt parser** — easiest, well-scoped extraction
2. **Timesheet reconciler** — advisory only, no approval flow needed
3. **Xero reconciler** — matches bank transactions to Expense/Invoice/Bill
4. **AP intake** — email to `bills@` → Draft Bill
5. **Invoice drafter** — month-end scheduled or manual
6. **AR chaser** — daily scan of overdue invoices
7. **Contract drafter** — deal won → .docx + DocuSign envelope

**Exit criteria:** every bill + receipt + invoice that used to be manual data entry now arrives pre-filled, with human approval as the only required step.

---

## Phase 4 — Payments & comms (weeks 20–28)

**Goal:** close the payment loop, add approval channels off-app.

- ABA file generation (payroll + bills mixed batch)
- pay.com.au integration (upload + status sync)
- WhatsApp Business: outbound approval templates, timesheet reminders, AR alerts
- WhatsApp inbound: receipt photo → expense, approval reply (YES/NO/REVIEW) with MFA >$20k
- DocuSign integration (envelope automation for contracts + consulting agreements)
- Teams notifications (adaptive cards in `#ops` channel)

**Exit criteria:** pay runs execute via pay.com.au from an approved ABA; partners approve invoices from WhatsApp; contracts sign in DocuSign.

---

## Phase 5 — Polish & handoff (weeks 26–30)

**Goal:** retire Excel-as-primary language; train staff; hand over.

- Kill "2-way synced" language everywhere; replace with "snapshot" / "regenerate"
- Remove the role switcher (dev-only); role comes from Entra group
- Move all localStorage prefs to `UserPreference` table
- Empty / loading / error states on every page
- Bulk import tool for historical projects + timesheets (optional, only if needed for backfill)
- Staff training doc
- Runbook: how to rotate secrets, re-auth integrations, respond to failed agent runs, replay webhooks

---

## Parallelisable streams

While Phase 1 is running, one developer can start on:
- Phase 3A (agent infrastructure) — independent of transactional schema
- Integration OAuth flows for WhatsApp + DocuSign — approvals take weeks (Meta template review)

While Phase 2 is running, continue on Phase 3 agents.

---

## Open decisions to resolve before Phase 4

These block Phase 4 if unresolved. Surface them early.

1. Super fund BPAY format — separate ABA line per employee, or Xero Payroll owns it?
2. FX support — AUD only, or USD/NZD needed?
3. Receipt OCR fallback — Sonnet only, or Textract for edge cases?
4. WhatsApp templates — Meta approval can take weeks; submit template set early.
5. ABA bank format variant — NAB vs CBA vs ANZ flavour?
6. MFA-for-WhatsApp-over-$20k acceptability — confirm with TT.
7. Per-agent monthly cost cap — default $50/mo, confirm.
