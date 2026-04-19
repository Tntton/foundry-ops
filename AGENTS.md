# AGENTS.md — Per-agent specifications

All agents are **human-in-the-loop**. No agent auto-executes destructive actions. Every agent:

- Runs as an Inngest workflow with a resumable `AgentRun` state
- Uses Claude (Anthropic API) — `claude-sonnet` for structured extraction + reasoning, `claude-haiku` for classification / routing
- Validates every LLM output with Zod; retries up to 3 times with error fed back; marks run `awaiting_human` on final failure
- Has a per-run cost cap ($0.20 default) and per-agent monthly cap ($50 default, alert at 80%)
- Writes an `AuditEvent` (actorType=`agent`) for every entity it creates or modifies
- Surfaces its queue on the Integrations & Agents screen (`screens-integrations-agents.jsx` is the reference)

See `TASKS.md` Phase 3 for the ordered build plan.

---

## 1. Receipt parser (`receipt_parser`)

**Status in prototype:** live · 142 runs/30d · 94% success · $0.012/run

**Trigger:**
- Email to `receipts@foundry.health` (Graph webhook subscription)
- WhatsApp photo from registered Person number
- In-app upload from My week / Expenses screens

**Input:** image (JPEG/PNG/HEIC) or PDF receipt.

**Output:** Draft `Expense` row with:
- `vendor`, `amount` (cents), `date`, `gst` (cents)
- `category` (classified into: travel / meals / office / tools / subscriptions / other)
- `confidence_score` (0-1)
- `receipt_sharepoint_url` — file filed to `/Expenses/<PersonCode>/<YYYY>-<MM>/<timestamp>.<ext>`
- `parsed_by_agent_run_id` on the row

**Approval gate:** Staff confirms draft before submitting. If `confidence < 0.7`, draft is flagged "needs review" — person must edit at least one field before submit.

**Model:** `claude-sonnet` with vision. Single call, structured output.

**Prompt inputs:** base64 image + known person + known projects list (person-on).

**Acceptance test fixtures (5 minimum):**
- Small Australian cafe receipt (handwritten-looking total)
- Uber/taxi receipt (digital, ABN + GST clearly printed)
- Flight booking PDF (multi-line)
- Supermarket receipt (long item list, single total)
- Multi-page PDF (only first page relevant)

---

## 2. AP intake (`ap_intake`)

**Status in prototype:** live · 38 runs/30d · 91% success · $0.018/run

**Trigger:** email arriving in `bills@foundry.health` (Graph webhook).

**Input:** email body + attachments.

**Output:**
- Draft `Bill` row: supplier, supplier_invoice_number, issue_date, due_date, amount_total, gst, category, project (if referenced), attachment_sharepoint_url
- Attachment filed to SharePoint `/AP/<YYYY>/<MM>/<filename>`
- `received_via = 'email'`, `original_email_id` set for traceability
- Supplier auto-matched to existing Person (contractor) or Organisation; flagged "new supplier" if not matched

**Approval gate:** Admin reviews draft → Super Admin approves (per A8 default). Approved bill pushes to Xero as draft Bill.

**Model:** `claude-sonnet` vision + text.

**Edge cases to handle:**
- Multiple attachments (take the PDF that looks like the invoice; discard signatures/cover emails)
- Forwarded emails (parse the original message context)
- Non-English receipts (rare but possible — Foundry works with some regional suppliers)
- Missing ABN / GST (flag, don't guess)

---

## 3. Invoice drafter (`invoice_drafter`)

**Status in prototype:** live · 24 runs/30d · 98% success · $0.025/run

**Trigger:**
- Manual ("Generate invoice for IFM001" button on project)
- Scheduled: month-end for all active projects with billable state

**Input:**
- Project record
- Unbilled approved timesheet entries (person_id, project_id, hours, description, date)
- Active rate card (bill_rate per role)
- Project milestones with `status = 'delivered'` and no invoice attached
- Last invoice for the project (for numbering + style continuity)

**Output:**
- Draft `Invoice` row with line items
- Rendered `.docx` filed to SharePoint `/Clients/<ClientCode>/<ProjectCode>/04 Admin/Invoices/`
- `generated_by_agent_run_id` set

**Approval gate:**
- Owning Partner reviews
- If `amount_total > $20,000`: Super Admin approval required (per A8)

**Model:** `claude-sonnet`.

**Grouping logic:**
- Milestones billed as fixed-fee line items
- T&M hours grouped by person (with rate) OR by project week — confirm preference on first build task

---

## 4. Contract drafter (`contract_drafter`)

**Status in prototype:** beta · 6 runs/30d · 83% success · $0.041/run

**Trigger:** Deal moves to `won` → "Draft SOW" button on Deal drawer.

**Input:**
- Deal record (value, scope notes, client)
- Client record (billing, ABN, legal name)
- Active rate card
- 3 most similar past SOWs (by client or scope keyword match) — as context examples

**Output:**
- `.docx` SOW in SharePoint `/Clients/<ClientCode>/<ProjectCode>/04 Admin/Contracts/`
- DocuSign envelope **created but not sent** (status `created`)

**Approval gate:** Super Admin reviews → routes to DocuSign to send.

**Model:** `claude-sonnet`.

**Safety rules:**
- Never auto-send. Envelope is created in DocuSign but left in draft.
- Flag clauses that deviate from the master template (rate structure, payment terms, IP ownership).
- If source context is thin (< 200 words of scope in Deal), return `awaiting_human` with a prompt for more detail.

---

## 5. AR chaser (`ar_chaser`)

**Status in prototype:** live · 58 runs/30d · 96% success · $0.004/run

**Trigger:** daily scan at 9am Sydney time.

**Input:** Xero AR aging report (invoices with `paidAt is null` and `dueDate < today`).

**Output:**
- Drafted follow-up email per overdue invoice, addressed to invoice's client billing contact, CC'd to owning Partner
- Draft saved to Outlook (Graph API: create draft in Partner's mailbox)
- Notification to Partner: "N chase emails drafted, review & send"

**Approval gate:** Partner reviews and sends via Outlook — **we don't auto-send**.

**Model:** `claude-haiku` (cheap classification + short-form drafting).

**Tone rules:**
- 0–14 days overdue: friendly reminder
- 15–30 days: firmer, reference PO / contract, ask for payment date
- 30+: suggest phone call, CC in accounts@

---

## 6. Timesheet reconciler (`timesheet_reconciler`)

**Status in prototype:** live · 12 runs/30d · 100% success · $0.002/run

**Trigger:** Friday 3pm Sydney time.

**Input:** for each active person, their M365 calendar for the week + their logged `TimesheetEntry` rows.

**Output:** in-app notification (and optionally WhatsApp — phase 4) to each person with calendar hours that don't appear on their timesheet.

**Approval gate:** none — advisory only. Agent never writes timesheet entries itself.

**Model:** `claude-haiku` for classification (is this calendar event billable? which project does "IFM discovery workshop" belong to?).

**Privacy:**
- Only the person and their manager see their own reconciliation nudge
- Don't include event titles in logs/audit beyond the current job context

---

## 7. Xero reconciler (`xero_reconciler`)

**Status in prototype:** live · 420 runs/30d · 88% success · $0.003/run

**Trigger:** nightly at 2am Sydney time (after Xero nightly sync completes).

**Input:** `BankTransaction` rows from the previous day's sync that don't yet have `matchedType` set.

**Output:** proposed match: for each transaction, suggest `Expense | Invoice | Bill | unknown` + confidence.

**Approval gate:** Admin confirms matches in a review queue. Confirmed matches write `xero_match_id` on the matched record.

**Model:** `claude-haiku`.

**Matching heuristics (let Claude use, but deterministic fallback first):**
1. Exact amount match + date within ±3 days → high confidence
2. Amount + vendor/description substring match → medium
3. Recurring pattern (same vendor, same amount, monthly) → OpexLine match

---

## Shared infrastructure

### Zod validation + retry loop

Every agent call:

```ts
async function callClaudeWithSchema<T>(
  prompt: string,
  schema: z.ZodSchema<T>,
  opts: { model: string; agentRunId: string; maxRetries?: number }
): Promise<T> {
  let lastError: Error | null = null;
  for (let i = 0; i <= (opts.maxRetries ?? 3); i++) {
    const raw = await claude(prompt + (lastError ? `\n\nPrevious attempt failed validation: ${lastError.message}` : ''), opts.model);
    await logLLMCall({...});
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    lastError = new Error(parsed.error.message);
  }
  throw new AgentValidationError(lastError!.message);
}
```

### Cost & budget enforcement

- Per-run: fail the run and mark `awaiting_human` if cumulative cost exceeds `$0.20` (configurable per-agent).
- Per-agent monthly: FeatureFlag / config-table budget; alert at 80%, hard-stop at 100% (pauses agent until human resets).

### Queue surface

The "Agents" tab on `/integrations-agents` shows each agent with:
- Status badge (live / beta / paused)
- 30-day runs, success rate, avg cost
- Expandable: input/output spec, approval gate, model, actions (View runs, Edit prompt, Run now)

All agents return to this screen on failure and surface the failed run with error + "replay" action.

### Prompt versioning

Each agent's prompt lives at `src/server/agents/<name>/prompt.ts` and exports:

```ts
export const PROMPT_VERSION = '2026-04-15.1';
export function buildPrompt(input: AgentInput): string { ... }
```

Bump `PROMPT_VERSION` on every meaningful prompt change. Logged on every `AgentRun` + `LLMCall` for reproducibility.
