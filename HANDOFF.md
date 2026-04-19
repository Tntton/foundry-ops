# Foundry Ops — Backend Handoff

Prepared for: Claude Code (or whichever engineer picks this up)
Prototype: `Foundry Ops.html` (React + inline JSX, design-fidelity mock)
Last updated: FY26

This document is the single source of truth for what to build. The HTML prototype shows **what the UI should look like and how it should flow**. This doc tells you **what the plumbing is**, what the data model is, and in what order to build. When they conflict, this doc wins — update the prototype to match.

---

## 0. TL;DR

Foundry Health is a ~12-person healthcare strategy consultancy based in Australia (with NZ staff). This platform consolidates their operating system: projects, P&L, timesheets, invoices, expenses, BD pipeline, partner true-up, resource planning, and directory. It replaces a sprawl of Excel workbooks on OneDrive + manual Xero entry + WhatsApp approvals.

**Core architectural decisions (locked):**

| # | Decision | Choice |
|---|---|---|
| A1 | Source of truth | **Database is authoritative.** Excel files are read-only exports (nightly + on-demand). |
| A2 | Identity master | **Foundry app is master.** M365 account provisioning is triggered from the Directory screen. |
| A3 | File storage | **SharePoint/OneDrive for everything** (client folders, HR docs, contracts, receipts). App stores pointers only. |
| A4 | Hosting region | No hard requirement. US/global region OK. |
| — | LLM provider | Claude (Anthropic API) |
| — | Tenancy | Single M365 tenant (`foundry.health`), no B2B guests |

---

## 1. Role & permission model

Five roles, hierarchical. Permission is **deny-by-default** — list what each role can do, not what they can't.

### 1.1 Roles

| Role | Who | Scope |
|---|---|---|
| **Super Admin** | Managing Partner (TT) | All approval authorities. Final sign-off on invoices >$20k, contracts, hires, pay runs, expense batches. |
| **Admin** | Office Manager (JS) | Back-end access: enter timesheets, raise invoices, manage directory, configure integrations. **Cannot** give final approval on anything requiring partner sign-off. |
| **Partner** | Partner + Associate Partner (MB, SR, etc.) | Sees firm P&L + their projects + their BD pipeline. Approves their own project expenses up to threshold. Signs off on their own client contracts. |
| **Manager** | Project Managers (MB when wearing PM hat, CC) | Sees their projects only. Manages team assignments, project budget, milestones. No firm-wide financials. |
| **Staff** | All other consultants, including contractors | Logs their own time & expenses. Views their own utilisation, rate, profile. Sees project brief/team for projects they're on. |

**Note:** a person can hold multiple roles. MB is both a Partner and a Project Manager on different projects. The permission system should evaluate "does any of this person's roles allow X?".

### 1.2 Permission matrix (representative — not exhaustive)

Legend: ✅ = can do, 👁 = read-only, ⬜ = no access, ✋ = can perform but requires approval from higher role

| Capability | Super Admin | Admin | Partner | Manager | Staff |
|---|:-:|:-:|:-:|:-:|:-:|
| **Projects** | | | | | |
| Create project | ✅ | ✅ | ✅ | ⬜ | ⬜ |
| Edit any project | ✅ | ✅ | 👁 own | ✋ own | ⬜ |
| Close project | ✅ | ✋ | ✅ own | ⬜ | ⬜ |
| **Finance** | | | | | |
| View firm P&L | ✅ | ✅ | ✅ | ⬜ | ⬜ |
| View project P&L | ✅ | ✅ | own | own | ⬜ |
| Approve invoice >$20k | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| Approve invoice ≤$20k | ✅ | ✅ | ✅ own client | ⬜ | ⬜ |
| Send invoice to client | ✅ | ✅ (after approval) | ⬜ | ⬜ | ⬜ |
| Approve expense >$2k | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| Approve expense ≤$2k | ✅ | ✅ | ✅ own proj | ✅ own proj | ⬜ |
| Enter own expense | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Payroll** | | | | | |
| Generate ABA | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| Approve pay run | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| **People** | | | | | |
| Add new person | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| Set rate card | ✅ | ⬜ | ⬜ | ⬜ | ⬜ |
| View own profile | ✅ | ✅ | ✅ | ✅ | ✅ |
| View others' rate / salary | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| **Configuration** | | | | | |
| Manage integrations | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| Run agent manually | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| View audit log | ✅ | ✅ | ⬜ | ⬜ | ⬜ |

Approval thresholds (`$20k invoice`, `$2k expense`) are **configurable**, not hard-coded.

---

## 2. Data model (canonical entities)

Not an ERD — a field inventory. Use it as a starting point; prefer a proper schema tool (Prisma, Drizzle, whatever) for real implementation.

### 2.1 Core entities

**Person**
- `id`, `initials` (unique, used as display code e.g. "TT"), `first_name`, `last_name`, `email` (unique, `@foundry.health` for FT)
- `band` (MP/Partner/Expert/Consultant/Analyst), `level` (MP/P/E1/E2/T1-T3/A1-A3)
- `employment` (FT / contractor), `fte` (0.1–1.0), `region` (AU/NZ)
- `rate_unit` (/h | /day), `rate` (cost rate AUD), `bill_rate` (charge rate AUD, optional)
- `roles` (array of role enums)
- `start_date`, `end_date` (null if active)
- `entra_user_id` (external, populated on M365 provisioning), `xero_contact_id` (for contractors paid via AP)
- `bank_bsb`, `bank_acc`, `super_fund_id` (for FT staff paid via Xero Payroll)
- PII fields (encrypted at rest, visible only to Super Admin / Admin)

**Client**
- `id`, `code` (e.g. "IFM"), `legal_name`, `trading_name`
- `abn`, `billing_address`, `billing_email`
- `xero_contact_id`, `primary_partner_id` (FK Person)
- `payment_terms` (net-14/30/45)

**Project**
- `id`, `code` (e.g. "IFM001"), `client_id`, `name`, `description`
- `stage` (kickoff / delivery / closing / archived)
- `contract_value` (AUD ex GST), `currency`
- `start_date`, `end_date` (forecast + actual)
- `primary_partner_id`, `manager_id`
- `sharepoint_folder_url`, `xero_tracking_category_value`
- `milestones` (array: `{id, label, due, amount, status, invoice_id}`)
- `team` (join: `{person_id, role_on_project, allocation_pct}`)

**Deal (BD pipeline)**
- `id`, `code` (e.g. "PNC002"), `client_id` (or prospective client), `name`
- `stage` (lead / qualifying / proposal / negotiation / won / lost)
- `expected_value`, `probability`, `weighted_value` (computed)
- `owner_id`, `target_close_date`
- `converted_project_id` (FK, null until won)

**Timesheet entry**
- `id`, `person_id`, `project_id`, `date`, `hours`, `description`
- `status` (draft / submitted / approved / billed)
- `approved_by`, `approved_at`, `billed_invoice_id`

**Expense**
- `id`, `person_id`, `project_id` (nullable for OPEX), `date`, `amount`, `currency`, `gst`
- `category` (travel/meals/office/tools/etc.)
- `vendor`, `description`
- `receipt_sharepoint_url`, `parsed_by_agent_id` (null if human-entered)
- `status` (draft / submitted / approved / rejected / reimbursed / batched_for_payment)
- `approved_by`, `approved_at`, `xero_bill_id` (once pushed)

**Invoice (AR — outbound)**
- `id`, `number` (e.g. "IFM001-INV-12"), `project_id`, `client_id`
- `issue_date`, `due_date`, `amount_ex_gst`, `gst`, `amount_total`
- `line_items` (array: `{label, hours, rate, amount, timesheet_entry_ids}`)
- `status` (draft / pending_approval / approved / sent / partial / paid / overdue / written_off)
- `generated_by_agent_id` (null if human-entered)
- `xero_invoice_id`, `sent_at`, `paid_at`, `payment_received_amount`

**Bill (AP — inbound, supplier invoice)**
- `id`, `supplier_id` (FK Person or Organisation), `supplier_invoice_number`
- `received_via` (email / upload / manual), `original_email_id` (if parsed by agent)
- `attachment_sharepoint_url`, `issue_date`, `due_date`, `amount_total`, `gst`
- `category`, `project_id` (if project-billable), `cost_centre`
- `status` (pending_review / approved / rejected / scheduled_for_payment / paid)
- `xero_bill_id`, `aba_batch_id` (links to the ABA that paid it)

**Pay run**
- `id`, `period_start`, `period_end`, `type` (payroll / super / contractor-AP / supplier-AP / mixed)
- `status` (draft / approved / aba_generated / uploaded_to_paydotcomau / paid / reconciled)
- `line_items` (array: `{person_id | bill_id, amount, bsb, acc, reference}`)
- `aba_file_url` (SharePoint), `xero_batch_ref`, `paydotcomau_batch_ref`
- `approved_by`, `approved_at`

**Approval**
- `id`, `subject_type` (invoice / expense / bill / pay_run / contract / new_hire / rate_change)
- `subject_id`, `requested_by`, `required_role` (super_admin / admin / partner / manager)
- `status` (pending / approved / rejected), `decided_by`, `decided_at`, `decision_note`
- `threshold_context` (e.g. `"invoice_amount: 48000, threshold: 20000"`)

**Audit event**
- `id`, `actor_id` (Person or Agent), `actor_type` (person / agent / system)
- `action` (created / updated / deleted / approved / rejected / sent / synced)
- `entity_type`, `entity_id`, `entity_delta` (jsonb diff)
- `at`, `ip`, `user_agent`, `source` (web / agent / api / integration_sync)

**Agent run**
- `id`, `agent_id` (receipt_parser / invoice_drafter / etc.), `trigger` (schedule / event / manual)
- `status` (running / succeeded / failed / awaiting_human)
- `input_ref` (e.g. email message ID), `output_entity_ids`
- `confidence_score` (0-1, where agent provides it)
- `started_at`, `finished_at`, `cost_usd` (LLM token cost)

### 2.2 Supporting tables

- **RateCard** — versioned: `role_code, effective_from, cost_rate, bill_rate_low, bill_rate_high`
- **OpexLine** — recurring cost: `category, vendor, amount_monthly, start, end, xero_bill_ids[]`
- **PartnerPool** — true-up computation inputs/outputs by period
- **Notification** — in-app + outbound channel (email, WhatsApp, Teams) queue
- **Integration** — config row per integration: `kind, auth_ref, last_sync_at, status, config_jsonb`

---

## 3. Integration contracts

### 3.1 Microsoft 365 (Graph API)

**Auth:** OAuth2 app registration in the `foundry.health` Entra tenant. Delegated + application permissions. Token stored encrypted in vault; refreshed automatically.

| Surface | Direction | Trigger | Use |
|---|---|---|---|
| Users & Groups | M365 → app (one-way read) | On app login + nightly sync | Resolve `entra_user_id` for person; fetch profile photo; verify group membership (maps to role) |
| Users (provisioning) | app → M365 | "Finish" on New Person wizard | Create user, mailbox, add to `FoundryStaff` group; trigger "welcome" email |
| OneDrive / SharePoint | app ↔ both | On project create + any file attach | Create client/project folder tree; store file pointers (not files); surface "Open in SharePoint" links |
| Excel Online | app → M365 (export only) | Nightly + on-demand | Generate read-only snapshots: `Finance.xlsx`, `Timesheet.xlsx`, `Invoices.xlsx`, `Expenses.xlsx`, `Pipeline.xlsx`, `Partner-pool.xlsx`. **No 2-way sync.** |
| Calendar | app ↔ M365 | On project kickoff / PAR review scheduled | Create event; invite attendees; surface "next PAR review" on My Profile |
| Mail | M365 → app (read only) | Agent-driven | `bills@foundry.health` inbox monitored by AP intake agent. `receipts@` monitored by receipt parser. Outbound AR chasers go through Outlook as the partner. |
| Teams notifications | app → Teams | On approval required, alert | Adaptive card in `#ops` channel; optional DM to required approver |

**Conflict policy:** since DB is authoritative, Excel exports are snapshot-only. If someone hand-edits an exported xlsx, changes are discarded next export. This must be signposted in the UI ("snapshot · regenerate" button instead of the current "2-way synced" language).

### 3.2 Xero

**Auth:** OAuth2 via Xero's app marketplace. Foundry connects their existing tenant once.

| Surface | Direction | Trigger | Use |
|---|---|---|---|
| Contacts | app ↔ Xero | On Client or contractor Person create/edit | Maintain `xero_contact_id` on both sides |
| Tracking Categories | app → Xero (write) | On Project create | Ensure a category value exists per active project code |
| Invoices (AR) | app → Xero (push draft) + Xero → app (status webhook) | On invoice approval in app | Push as draft; Xero webhook updates `status` + `paid_at`. App remains the origin; invoice edits in Xero after push are blocked (soft — we show a conflict flag). |
| Bills (AP) | app → Xero (push) | On bill approval OR on pay-run generation | Push supplier invoices as Xero Bills. Status/payment synced back. |
| Bank transactions | Xero → app (read) | Nightly | Used by Xero Reconciler agent to match against expense/invoice records |
| Payroll | Xero Payroll (handled in Xero) | — | Foundry generates ABA here; Xero also runs payroll. We push pay run records as a batch to Xero for GL purposes but **don't use Xero to execute**. |
| Chart of accounts | Xero → app (read, cached) | Nightly | For bill categorisation in the app to match Xero's GL codes |

Both mappings exist: **project = tracking category** for P&L reporting, **client = contact** for invoicing. Projects under the same client share a contact but carry distinct tracking category values on every line.

### 3.3 pay.com.au

**Auth:** Credentials / API key stored in vault. Or, if no API — download ABA and upload manually.

| Direction | Use |
|---|---|
| app generates | **ABA file** for pay run (payroll + supplier payments mixed). Standards-compliant NAB/CBA ABA with header/detail/trailer records. |
| app → Xero (upload copy) | ABA file attached to Xero batch for accounting record |
| app → pay.com.au | ABA file uploaded (manually at first; automated via API if available) for execution |
| pay.com.au → app | Webhook OR status pull: "batch executed, settled at …" → app marks pay run paid; ripples to bills/payroll records |

**ABA generation inputs:** approved bills (AP) + approved payroll line items + approved contractor payments. Output is a single batch per run. Super Admin approves each run.

### 3.4 WhatsApp Business

**Auth:** Meta Business Platform (Cloud API). Requires phone number verified with Meta + business display name approved.

**Two-way, template-driven:**

| Use case | Outbound template | Inbound handling |
|---|---|---|
| Approval request | "Foundry: Approval needed — {{1}}. Reply YES to approve, NO to reject, REVIEW to open in app." | `YES` / `NO` with auth check (number must match approver's registered number + MFA code if >$20k) |
| Timesheet reminder | "Foundry: Your timesheet is due. Tap here to log: {{url}}" | No inbound |
| Overdue AR alert | "Foundry: Invoice {{1}} is {{2}} days overdue. Tap to review: {{url}}" | No inbound |
| Receipt photo → expense | (outbound only on setup: "Send a photo to this chat to log an expense") | Inbound photo → upload to SharePoint → trigger Receipt Parser agent → creates draft expense → confirm via reply |
| Kickoff announcement | (client-facing, compliance review before launch — **defer to phase 2**) | — |

**Reply authentication:** WhatsApp numbers must be pre-registered on Person records. Mutating actions (approval, expense submission) require the source number to match a known person. High-value approvals (`>$20k`) get a 6-digit MFA challenge via WhatsApp before accepting.

### 3.5 DocuSign

**Auth:** OAuth2 via DocuSign marketplace.

| Use case | Flow |
|---|---|
| Client contract | Contract Drafter agent generates .docx → Super Admin approves → push to DocuSign envelope → sent to client signatory → webhook back on signed |
| Consulting agreement | Same, for new hires/contractors |

---

## 4. Agents (human-in-the-loop)

All agents default to **queue-for-human-approval**. No agent auto-executes destructive actions.

LLM: **Claude (Anthropic API)**. Model: `claude-sonnet` for structured extraction, `claude-haiku` for classification/routing.

### 4.1 Agent catalog

| # | Agent | Trigger | Input | Output | Approval gate |
|---|---|---|---|---|---|
| 1 | **Receipt parser** | Email to `receipts@`, WhatsApp photo, or in-app upload | image/PDF receipt | Draft `Expense` record (vendor, amount, date, GST, category) | Staff confirms draft before submit |
| 2 | **AP intake** | Email to `bills@foundry.health` | inbound email + attachments | Draft `Bill` record, attachment filed to SharePoint `/AP/{YYYY}/{MM}/` | Admin reviews → Super Admin approves |
| 3 | **Invoice drafter** | Manual ("Generate invoice for IFM001") or scheduled (month-end) | Project milestones + approved timesheet entries + rate card | Draft `Invoice` record + rendered .docx in SharePoint | Partner reviews → Super Admin approves if >$20k |
| 4 | **Contract drafter** | Deal won → "Draft SOW" | Deal + client + rate card + past similar work | Draft .docx in SharePoint; DocuSign envelope (not sent) | Super Admin reviews + routes to DocuSign |
| 5 | **AR chaser** | Daily scan | Xero AR aging report | Drafted follow-up emails per overdue invoice | Partner reviews & sends via Outlook |
| 6 | **Timesheet reconciler** | Friday 3pm | Person's M365 calendar + logged hours | Nudge to person with gaps | No approval — advisory only |
| 7 | **Xero reconciler** | Nightly | Xero bank feed transactions | Proposed matches to Foundry `Expense` / `Invoice` / `Bill` records | Admin confirms matches |

### 4.2 Agent infrastructure requirements

- **Orchestration:** a job queue (e.g. BullMQ / Inngest). Agents are workflows, not one-shot prompts.
- **State machine:** each agent run is an `AgentRun` record; resumable on crash.
- **Prompt versioning:** prompts in source code, versioned; log `prompt_version` on each run for reproducibility.
- **Guardrails:** schema validation on every LLM output (Zod). Reject & retry if invalid. Budget per run (max 3 retries, $0.20 cost ceiling).
- **Observability:** every LLM call logged (input, output, tokens, latency, cost) for audit.
- **Human handoff:** every agent has a "queue" surface in the app (the Integrations & Agents screen); humans can review, accept, edit, reject.

---

## 5. Suggested build order

### Phase 1 — Operational core (target: ASAP, ~8-12 weeks)
Everything Foundry needs to run day-to-day without the agents.

1. **Foundation**
   - Auth (M365 SSO, tenant-restricted, Entra group → role mapping, magic-link for contractor fallback)
   - Data model + migrations
   - Role/permission middleware
   - Audit log (tail every mutation)
2. **Identity & config**
   - Directory screen (people + clients)
   - New Person wizard → provisions M365 account
   - Rate card
3. **Project lifecycle**
   - Project wizard → creates SharePoint folder + Xero tracking category
   - Project detail (tabs: brief, team, milestones, P&L, files)
   - Project portfolio (firm view, partner/manager views)
4. **Transactional flows**
   - Timesheets (staff submit → manager approve → billable)
   - Expenses (staff submit → approve → queue for reimbursement)
   - Invoices (draft → approve → push to Xero as draft → status sync)
   - Bills (admin upload → approve → push to Xero)
5. **Approvals queue** — central inbox for anyone with approval authority
6. **Xero integration** (one-way initially: app pushes, Xero syncs status back)
7. **Excel exports** (nightly snapshots of core workbooks — replace "2-way sync" language in UI)

### Phase 2 — Firm intelligence (weeks 12-20)
8. **Firm P&L + waterfall** (derived view over transactional data)
9. **Cost planning + OPEX tracker**
10. **BD pipeline + deal → project conversion**
11. **Resource planning** (allocation × capacity)
12. **Partner true-up** (period close → pool computation → payout)

### Phase 3 — Agents (weeks 18-30, overlaps phase 2)
13. Agent orchestration infrastructure (queue, observability, prompt versioning)
14. **Receipt parser** (easiest — well-scoped extraction)
15. **AP intake** (email → Bill)
16. **Timesheet reconciler** (advisory only — no approval needed)
17. **Xero reconciler**
18. **Invoice drafter**
19. **Contract drafter**
20. **AR chaser**

### Phase 4 — Payments & comms (weeks 24-32)
21. **ABA generation** (payroll + bills → ABA file)
22. **pay.com.au integration** (upload, status sync)
23. **WhatsApp integration** (outbound templates first, then inbound for approvals & receipts)
24. **DocuSign integration** (envelope automation for contracts)
25. **Teams notifications**

---

## 6. Stack recommendation

Not prescriptive — Claude Code should pick what's familiar. Some suggestions that fit the shape:

- **Frontend:** React (matches prototype), Next.js app router, TanStack Query, Tailwind + shadcn/ui (the hifi.css Foundry tokens can be ported)
- **Backend:** Next.js API routes OR a separate Node/TS service (NestJS, Hono). Foundry is small — a monolith is fine.
- **DB:** Postgres. Prisma or Drizzle.
- **File storage:** SharePoint (via Graph) — no S3 needed.
- **Queue:** Inngest or BullMQ for agent jobs.
- **Auth:** NextAuth with Entra ID provider; magic link for contractors.
- **Secrets:** whatever host provides (Vercel env, Railway, Fly) — later, move to a vault.
- **Observability:** Sentry + something for LLM call logging (Langfuse, Helicone, or roll your own on Postgres).

---

## 7. Known open items / decisions for the team

These aren't blockers but should be resolved during build:

1. **Super fund integration** — FT staff have super contributions. Currently quoted via Xero Payroll. Confirm whether ABA generation needs a separate super BPAY line per employee, or if Xero Payroll handles super separately.
2. **FX** — contracts are AUD. Any USD / NZD projects? If yes, add `currency` handling everywhere money appears (already in the schema).
3. **Timezones** — AU + NZ staff. Store timestamps in UTC, render in user's local. Trivial but flag for design review.
4. **Receipt OCR provider** — Claude Sonnet is fine for text but scans can be messy. Consider fallback to an OCR service (AWS Textract) if quality is poor.
5. **WhatsApp template approvals** — Meta must pre-approve outbound templates. Build the template list early, submit for approval before integration work starts.
6. **ABA banking format variant** — Australian banks accept slightly different ABA flavours (NAB vs CBA vs ANZ). Confirm which bank the ABA must target.
7. **MFA for WhatsApp approvals >$20k** — confirm user-flow is acceptable to TT (Super Admin). Alternative: route all >$20k approvals through the web app only.
8. **Agent cost caps** — set per-agent monthly budget. Suggest $50/mo per agent initially, alert at 80%.

---

## 8. Prototype → production mapping

The prototype deliberately simplifies some things. When building, expect to encounter these gaps:

| Prototype behaviour | Production reality |
|---|---|
| "Excel 2-way synced · 2m ago" footer | Replace with "Last snapshot: 2m ago · regenerate" |
| Role switcher in top-right | Remove — role comes from Entra group |
| localStorage-persisted state (screen, dashboard layout, role) | Move all user prefs to a `UserPreference` table |
| Hardcoded `window.__auth` session | Real session cookies + server-side role check on every request |
| Fake data (IFM001, GNC001, etc.) | Seed a staging DB from a realistic subset; production starts empty |
| Modals confirm success instantly | Real approvals are async; show pending state + notify on decision |
| "Live from Finance.xlsx" microcopy | Remove — the DB is live |

---

## 9. Files in this prototype (reference map)

| File | What's in it |
|---|---|
| `Foundry Ops.html` | App shell, nav, role switcher, auth gate |
| `screens-auth.jsx` | Login, SSO modal, logout page |
| `screens-1.jsx` | Firm dashboard (configurable section layout) |
| `screens-2.jsx` | Projects list, project wizard sidebar |
| `screens-3.jsx` | Admin screens (integrations, templates, SSO config mock) |
| `screens-4.jsx` … `screens-8.jsx` | Other core screens (invoices, expenses, approvals, etc.) |
| `screens-pnl.jsx` | Firm P&L, waterfall, forecast sandbox |
| `screens-bd-*.jsx` | BD pipeline |
| `screens-projects.jsx` | Project detail (tabbed) |
| `screens-directory-people.jsx` | Directory, new-person wizard |
| `screens-costplan.jsx` | Cost planning |
| `screens-resource-*.jsx` | Resource planning |
| `screens-trueup-*.jsx` | Partner true-up |
| `screens-me.jsx` | "My profile" (staff self-service) |
| `foundry-team.jsx` | PERSON_DB fixture (real team names, rates, employment status) |
| `foundry-ratecard.jsx` | Rate card fixture |
| `shared.jsx`, `components-shared.jsx`, `hifi.css` | UI primitives, tokens |

---

*End of handoff.*
