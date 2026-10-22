# Design proposal — Feedback #12: Timesheet & invoice inputs

**Raised by:** Matt Byers · 2026-06-09 · routine / feature
**Status:** proposal for TT decision — no code written yet

> **Timesheets:** Unable to select non-project / old project codes as inputs for the
> timesheet, so can't accurately record time attributed to non-project work or to
> projects now completed.
>
> **Invoices:** Unable to generate an invoice that spans multiple project codes, so
> would currently need to generate multiple invoices if working across multiple
> projects within a single time period.

These are two independent asks. The timesheet half is small and low-risk. The invoice
half is a schema + financial-attribution change and is the one that needs a real
decision.

---

## Part A — Timesheet: non-project & completed-project time

### What happens today
- The add-project picker shows **every non-archived project** to everyone
  ([timesheet/page.tsx:194](../../src/app/(app)/timesheet/page.tsx)).
- **Archived** projects only appear if the person already has a footprint on them
  (team membership or an existing entry) — so you can't book late time to an archived
  project you weren't on.
- Internal work already has homes: **FHP000 / FHP001+** internal projects *do* show in
  the picker. The **FHB000 / FHO000 / FHX000** codes are firm-overhead *expense buckets*
  and are deliberately hidden from project surfaces
  ([projects.ts:147](../../src/server/projects.ts)) — they're for OPEX bills, not
  timesheet time.
- `closing`-stage ("wrapping up") projects are **not** archived, so they're already
  selectable. The gap is specifically **archived** projects.

### So the real gaps are
1. **Non-project time** has no obvious, discoverable code for a consultant. FHP000
   exists but isn't labelled "non-project / internal" in the picker, and the overhead
   buckets that *look* right (FHO000 "office") are hidden.
2. **Archived projects** can't be picked for a late/correcting entry unless you were
   already on them.

### Proposed change (small, low-risk)
1. **Surface a clear "Internal / non-project" option** in the timesheet picker, backed
   by a canonical internal project. **Decision A1:** which code is the home for
   non-project consultant time — reuse **FHP000** (recommended), or introduce a new
   dedicated code (e.g. `FHN000` "non-project")? Reusing FHP000 needs no migration.
2. **Add an opt-in "Show completed / archived" toggle** to the add-project picker.
   Off by default (keeps the list short); when on, it includes `closing` + `archived`
   projects so any project can receive a correcting entry. Server `saveTimesheet` keeps
   its existing rule that archived-project entries don't auto-approve — they route to
   normal approval.

**Effort:** ~half a day. No schema change. Touches the timesheet page project query +
the add-row picker component. No collision with the current `projects/*` work if we keep
it to `timesheet/`.

---

## Part B — Invoice spanning multiple projects

### What happens today
- `Invoice.projectId` is a **required, single** foreign key. One invoice → one project.
- `InvoiceLine` has **no** project of its own — every line belongs to the invoice's one
  project.
- Invoice **number** is derived from the project code: `"{projectCode}-INV-NN"`
  ([invoices.ts:90](../../src/server/invoices.ts)).
- Revenue **attribution reads `invoice.projectId`** across P&L, partner scorecard,
  client concentration, budget-watch, and FY-budget reports.
- Xero push stores one `xeroInvoiceId` per invoice.

A client that spans, say, `IFM003` and `IFM004` in one month therefore requires two
separate invoices with two numbers — Matt's complaint.

### Options

**Option A — Client-level invoice, project moves to the line (clean, biggest blast).**
Make `Invoice.projectId` nullable, anchor the invoice to the **Client**, and add
`InvoiceLine.projectId`. One invoice, many projects, per-line attribution.
- *Pros:* the "right" model; a single invoice/PDF/Xero doc for the client.
- *Cons:* touches numbering (needs a client-level scheme like `IFM-INV-NN`), every
  revenue report (re-attribute by line, not header), the preview/PDF template, the Xero
  sync (per-line tracking category), the invoice-drafter agent, and approval/threshold
  code. Largest migration + regression surface.

**Option C — Primary project + cross-project lines (recommended middle ground).**
Keep `Invoice.projectId` as the **billing/primary** project (so numbering, client, and
the existing header attribution keep working), and add an **optional
`InvoiceLine.projectId`** so individual lines can draw from *sibling projects of the same
client*. Reports switch to "line project if set, else header project."
- *Pros:* one invoice + one number + one Xero doc spanning projects; small additive
  migration (one nullable column); numbering untouched; backward-compatible (existing
  invoices have null line-projects → behave exactly as today).
- *Cons:* reports need a line-aware attribution helper (moderate but mechanical); still
  one "primary" project on the header (fine — it's the billing anchor).
- *Guardrail:* lines may only reference projects belonging to the **same client** as the
  invoice (enforced server-side).

**Option B — No model change; batch/"combined statement" (smallest).**
Keep per-project invoices but add a one-action "invoice this client's projects for the
period" that generates the set together, plus an optional combined cover PDF.
- *Pros:* tiny; no migration; no report changes.
- *Cons:* doesn't actually satisfy "one invoice number across projects" — still N Xero
  docs and N numbers. Likely doesn't fully close Matt's ask.

### Recommendation
**Option C.** It delivers the single cross-project invoice Matt wants with the smallest
schema change and preserves numbering + Xero + approvals. Reserve Option A for if/when
you want to drop the notion of a primary project entirely.

### Decisions needed (Part B)
- **B1 — Approach:** A (client-level), **C (primary + cross-project lines, recommended)**,
  or B (batch only)?
- **B2 — Numbering** (only if A): client-level `IFM-INV-NN`, or keep project-derived?
- **B3 — Attribution:** confirm reports should attribute by **line project when set**
  (needed for C and A to keep P&L/scorecard correct).
- **B4 — Scope guard:** confirm cross-project lines are restricted to the invoice's
  client (recommended yes).
- **B5 — Xero:** do you want per-line project as a Xero **tracking category** on push?
  (Requires the tracking category to exist in Xero.)

---

## Suggested sequencing
1. **Ship Part A now** (independent, low-risk, no decisions beyond A1).
2. **Part B after B1–B5 are answered.** With Option C, rough effort is ~2–3 focused
   sessions: migration (add nullable `InvoiceLine.projectId`) → invoice create/draft UI
   (add lines from sibling projects) → line-aware attribution helper + report wiring →
   preview/PDF + Xero line tracking → tests.

## Out of scope / risks
- Not touching contractor bills or expense recharge here.
- Report attribution is the main regression risk in B — every revenue surface must move
  to the shared line-aware helper in one change so numbers stay consistent.
- Migration runs manually against prod (per infra) — sequence as its own commit before
  the feature commit.
