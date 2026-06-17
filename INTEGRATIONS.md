# INTEGRATIONS.md — Per-integration specifications

Five external systems. Each has its own auth flow, surfaces, sync rules, and failure handling. This doc expands `HANDOFF.md §3` with implementation detail.

---

## 1. Microsoft 365 (Graph API)

**Status in prototype:** connected · last sync 2m

**Auth:** OAuth2 app registration in `foundry.health` Entra tenant. Delegated permissions for user-scoped actions (read my calendar); application permissions for admin jobs (provision user, create group membership). Tokens stored encrypted; refresh on expiry.

**Required Graph permissions:**
- `User.Read.All` (app) — directory sync
- `User.ReadWrite.All` (app) — provisioning
- `GroupMember.ReadWrite.All` (app) — role via group membership
- `Files.ReadWrite.All` (app) — SharePoint provisioning
- `Sites.ReadWrite.All` (app) — folder structure
- `Mail.Read` (app, scoped via `New-ApplicationAccessPolicy` to `finance@foundry.health` + `trung@foundry.health` only) — AP autoharvest cron. See §7 for the grant + scoping steps.
- `Calendars.Read` (delegated) — timesheet reconciler
- `ChannelMessage.Send` (app) — Teams notifications

**Surfaces:**

| Surface | Direction | Trigger | Notes |
|---|---|---|---|
| Users & Groups | M365 → app | App login + nightly | Resolves `entra_user_id` on Person; maps Entra group → Role |
| Users (provisioning) | app → M365 | New Person wizard "Finish" | Creates mailbox, adds to `FoundryStaff` group |
| OneDrive / SharePoint | app ↔ both | Project create, file attach | App stores pointers only, never binaries |
| Excel exports | app → M365 | Nightly + on-demand | Read-only snapshots. **No 2-way sync.** |
| Calendar | app ↔ M365 | Project kickoff, PAR review | Events + invites |
| Mail | M365 → app | Cron poller (15 min) | `finance@` + `trung@` polled directly via Graph (§7). Receipts no longer email-routed — see §6 (Uber) + WhatsApp inbound. |
| Teams | app → Teams | Approval events | Adaptive cards to `#ops`, DM to required approver |

**Role → Entra group mapping:**
- Super Admin → `FoundrySuperAdmins`
- Admin → `FoundryAdmins`
- Partner → `FoundryPartners`
- Manager → `FoundryManagers`
- Staff → `FoundryStaff`

A person can be in multiple groups; roles array is the union.

**Conflict policy:** DB is authoritative. Excel exports are snapshots. UI must say "Last snapshot: Nm ago · regenerate", never "2-way synced".

**Failure handling:**
- Token refresh fails → mark integration `error`, surface banner to Admin
- Graph rate limit (429) → exponential backoff, max 5 retries
- Nightly sync fails → fire alert, retry hourly until green

---

## 2. Xero

**Status in prototype:** connected · last sync 5m

**Auth:** OAuth2 via Xero marketplace. One-time connect by Super Admin. Refresh token stored encrypted. Tokens expire every 30 min; refresh automatically.

**Required scopes:** `accounting.contacts accounting.transactions accounting.settings offline_access`

**Surfaces:**

| Surface | Direction | Trigger | Notes |
|---|---|---|---|
| Contacts | app ↔ Xero | Client / contractor create/edit | Maintains `xero_contact_id` on both sides |
| Tracking categories | app → Xero | Project create | One category "Projects", value per active project code |
| Invoices (AR) | app → Xero + webhook | On invoice approve | Push as draft; Xero status syncs back |
| Bills (AP) | app → Xero + webhook | On bill approve | Push as draft Bill |
| Bank feed | Xero → app | Nightly | Powers Xero Reconciler agent |
| Chart of accounts | Xero → app (cached) | Nightly | Maps bill category → GL code |

**Webhook verification:** Xero signs webhooks with HMAC-SHA256. Verify `x-xero-signature` header against raw body using webhook secret before processing.

**Conflict handling:**
- Invoice pushed to Xero, then edited in Xero: app shows a conflict flag; user must decide "overwrite Xero from app" or "accept Xero edits"
- Duplicate contact (Xero has a contact with same ABN): match by ABN, link instead of creating

**Rate limits:** 60 calls/min per tenant. Queue + backoff.

---

## 3. pay.com.au

**Status in prototype:** configuring

**Auth:** API key stored in vault. If no API available initially: manual ABA upload + status check via web scraping (phase 4 fallback).

**Surfaces:**

| Direction | Use |
|---|---|
| app generates | ABA file (NAB/CBA/ANZ flavour — TBD) |
| app → Xero (copy) | Attach ABA to Xero batch for record |
| app → pay.com.au | Upload ABA |
| pay.com.au → app | Status webhook: batch executed, settled |

**ABA format:** Australian standard, header/detail/trailer. Confirm bank flavour with TT before building.

**Approval:** Super Admin must approve every pay run before ABA generates (per A8).

---

## 4. WhatsApp Business

**Status in prototype:** pending_approval (Meta template review in progress)

**Auth:** Meta Business Cloud API. Requires:
- Verified phone number
- Approved business display name
- Pre-approved message templates (Meta review: ~1-7 days per template)

**Templates to submit (early — approval is a critical-path dependency):**

| Name | Purpose | Variables |
|---|---|---|
| `approval_request` | Approval needed for invoice/bill/etc. (<$20k only) | `{1}` subject, `{2}` amount; button URL `{1}` approval id |
| `timesheet_reminder` | End-of-week reminder | `{1}` first name |
| `ar_overdue` | Overdue invoice alert | `{1}` invoice number, `{2}` days; button URL `{1}` invoice id |
| `receipt_intake_instructions` | Onboard: "send a photo to log an expense" | — |

**High-value approvals are web-only** (TT 2026-06-18). Subjects ≥ AUD 20,000 do NOT trigger a WhatsApp DM — they go in-app + email only, and the approver must authenticate via Entra ID + decide in the web app. `notifyApproversOfNewApproval` enforces this gate (`WHATSAPP_MAX_AMOUNT_CENTS = 2_000_000`). No `approval_mfa` template — the MFA flow is replaced by full-session web auth.

**Inbound auth (for mutating actions):**
- Source number must match a registered Person's `whatsappNumber`
- `YES` / `NO` / `REVIEW` literal matching
- Subjects ≥ $20k never reach this path — the WhatsApp DM was suppressed upstream, so there's no inbound decision to authenticate.

**Media handling:**
- Inbound photos → download via Meta media API → upload to SharePoint → trigger Receipt Parser agent
- Bot replies with draft summary; person replies `CONFIRM` or edits

**Compliance:**
- Kickoff announcements (client-facing) deferred to phase 2 — need compliance review

---

## 5. DocuSign

**Status in prototype:** connected · last sync 1h

**Auth:** OAuth2 via DocuSign marketplace.

**Required scopes:** `signature impersonation`

**Surfaces:**

| Use case | Flow |
|---|---|
| Client contract | Contract Drafter agent creates .docx → Super Admin approves → push to DocuSign envelope → Super Admin sends → webhook updates status on signed |
| Consulting agreement | Same flow, for new hires / contractors (triggered from New Person wizard) |

**Webhook verification:** HMAC-SHA256 on `X-DocuSign-Signature-1` header.

**Envelope lifecycle we track:** `created → sent → delivered → signed → completed` (or `declined` / `voided`).

**Safety:** agent creates envelope but never sends. Human must click "Send via DocuSign" after review.

---

## 6. Uber for Business — email-intake (Power Automate)

**Status:** active · pairs with `/api/cron/uber-receipts-pull` (every 15 min).

Uber for Business' standard delivery channels are an SFTP endpoint (set up via `/admin/integrations/uber`) and an OAuth REST feed. Both work, but Uber's SFTP gates on IP-allowlisting and Vercel's outbound IPs rotate, which leaves the per-ride email receipt as the only near-real-time channel that doesn't need a static-IP egress. This integration is the email path: a Microsoft Power Automate flow on a Foundry mailbox watches for `noreply@uber.com` ride-receipt emails and drops the PDF attachment into a SharePoint folder. The Foundry-side cron lists the folder every 15 min, OCRs each PDF, lands an Expense attributed to the rider, and moves the file to `Processed/YYYY-MM-DD/`.

Why **Expense** (not Bill, unlike the CSV / SFTP feeds): the email arrives because the ride was paid on a *personal* card (Uber emails the rider). The corporate-AMEX channel for Uber for Business still flows in as Bills via the existing CSV / SFTP feeds. Both paths share the same `uber:trip:<id>` dedupe key, so a receipt that arrives both ways lands once.

### Power Automate flow recipe

One-time setup. TT (or any Super Admin) configures it from `flow.microsoft.com` while signed in to the `foundry.health` tenant. Run on TT's mailbox to start; once a shared `uber-receipts@foundry.health` mailbox exists, move the flow there for redundancy.

1. **Create flow** → "Automated cloud flow" → trigger **"When a new email arrives (V3)" (Office 365 Outlook)**.
2. **Trigger config:**
   - *Folder*: `Inbox` (or a sub-folder you've set up an inbox rule to route Uber receipts into — recommended, keeps the trigger cheap).
   - *From*: `noreply@uber.com`
   - *Subject Filter*: `Your`  *(matches "Your trip with Uber" / "Your Uber receipt" — both subject lines Uber has used in the past year. Leave loose; the SharePoint dedupe will drop double-arrivals.)*
   - *Include Attachments*: `Yes`
   - *Only with Attachments*: `Yes`
3. **Action 1: "Apply to each"** over `Attachments` (dynamic content).
4. **Inside the loop** → action **"Create file" (SharePoint)**:
   - *Site Address*: pick the Foundry corporate SharePoint site (same site Foundry Ops uses).
   - *Folder Path*: `/Shared Documents/CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/05 Uber Receipts/Inbox`  *(must match `SHAREPOINT_UBER_INBOX_PATH`; the path under "Shared Documents" is the same string the env var holds.)*
   - *File Name*: the expression below — **critical** for rider-match:
     ```
     @{toLower(triggerOutputs()?['body/to']?['value']?[0]?['address'])}__@{items('Apply_to_each')?['Name']}
     ```
     This prefixes the original attachment name with the recipient email + `__` delimiter. Example output: `julia@foundry.health__Uber receipt 2026-05-28.pdf`. The Foundry-side cron parses this prefix to attribute the Expense to the right Person without re-reading the message.
   - *File Content*: `Attachments Content` (dynamic content).
5. **Save**. Test by re-sending yourself a past Uber receipt or kicking off a $0 trial trip.

**Shared-mailbox variant.** When you move the flow off TT's personal mailbox and onto `uber-receipts@foundry.health`, the trigger becomes **"When a new email arrives in a shared mailbox (V2)"** and the rider email lives in `triggerOutputs()?['body/toRecipients']` — adjust the filename expression accordingly. Easiest to recreate the flow with the new trigger and copy the SharePoint action across, rather than edit in place.

### Foundry-side configuration

- `SHAREPOINT_UBER_INBOX_PATH` and `SHAREPOINT_UBER_PROCESSED_PATH` — see `.env.example`. Defaults nest under the existing admin tree.
- Cron is wired in `vercel.json` at `*/15 * * * *`. Vercel Pro is required for sub-hourly schedules.
- Health-check: `/admin/integrations/uber` has an "Email-intake" card with last-poll timestamp + 24h counters. The `/system-status` page surfaces the cron heartbeat as the `Uber for Business` component.

### Failure handling

- **Unmatched rider** (filename prefix unparseable + OCR can't find an email in the PDF, or the email doesn't match a Person row): file moves to `Processed/_unmatched/`, no Expense created. Surfaced in the admin card's "Files unmatched (24h)" counter. Admin can fix the Person row (add the email alias) and drag the file back into Inbox for a re-run.
- **OCR failure** (Anthropic outage, malformed PDF): file is left in `Inbox/` and the failure surfaces in "Files failed (24h)". The next cron fire retries; no data loss.
- **SharePoint outage / Graph 5xx**: cron logs the error in Vercel; the per-file try/catch keeps unrelated files moving. Re-run is idempotent (dedupe by `uber:trip:<id>` on Expense.description and Bill.supplierInvoiceNumber).
- **Power Automate quota / disable**: emails accumulate in the mailbox; restoring the flow re-processes the backlog. No SharePoint-side retention concerns at Foundry's volume.

---

## 7. Mail intake — AP autoharvest (Graph polling)

**Status:** building (TASK-093) · pairs with `/api/cron/invoice-autoharvest` (every 15 min).

Vendor invoices arriving by email land as draft `Bill` rows queued for partner/admin approval. This is the AP-side counterpart to the manual upload flow at `/bills/intake` (TASK-046). Two mailboxes are polled:

| Mailbox | Role | Lifecycle |
|---|---|---|
| `finance@foundry.health` | Canonical, end-state. Shared mailbox vendors are migrated to. | Permanent. |
| `trung@foundry.health` | Transitional. TT receives invoices on his personal inbox; the cron filters aggressively to invoice-looking mail only. | Disabled via the admin toggle once all vendors finish migrating to `finance@`. |

### Required permissions

`Mail.Read` (Application). **Critical:** scope this via Exchange Online `ApplicationAccessPolicy` so the app can read only the two mailboxes — without this, application-level `Mail.Read` is tenant-wide (every mailbox in `foundry.health`). Per CLAUDE.md A6 (deny-by-default), tenant-wide is not acceptable.

### One-time setup (TT / Super Admin)

**Step 1 — Grant Mail.Read on the Entra app.**
1. Azure portal → **Microsoft Entra ID** → **App registrations** → open the existing `Foundry Ops` app registration.
2. **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions** → check `Mail.Read` → **Add permissions**.
3. **Grant admin consent for foundry.health** (button at the top of the permissions list). Confirm the row shows "Granted for foundry.health" with a green tick.

**Admin-consent URL (for an audit-friendly trail — paste into a Global Admin browser session):**
```
https://login.microsoftonline.com/{ENTRA_TENANT_ID}/adminconsent?client_id={ENTRA_CLIENT_ID}
```
Substitute the tenant + client IDs from `.env.local`.

**Step 2 — Restrict the app to the two mailboxes via Exchange Online PowerShell.**

Install + connect (one-time, from any admin workstation):
```powershell
Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser
Connect-ExchangeOnline -UserPrincipalName trung@foundry.health
```

Create a mail-enabled security group containing the two target mailboxes (the policy is mail-group-scoped, not per-user):
```powershell
New-DistributionGroup -Name "Foundry Ops Mail Intake" `
  -Alias "foundry-ops-mail-intake" `
  -Type "Security" `
  -PrimarySmtpAddress "foundry-ops-mail-intake@foundry.health" `
  -Members @("finance@foundry.health", "trung@foundry.health")
```

Apply the application access policy (replace `{ENTRA_CLIENT_ID}` with the app registration's client ID — see `.env.local`):
```powershell
New-ApplicationAccessPolicy `
  -AppId "{ENTRA_CLIENT_ID}" `
  -PolicyScopeGroupId "foundry-ops-mail-intake@foundry.health" `
  -AccessRight "RestrictAccess" `
  -Description "Foundry Ops AP autoharvest — Mail.Read limited to finance@ + trung@"
```

Verify it took effect (should return `AccessAllowed`):
```powershell
Test-ApplicationAccessPolicy -Identity finance@foundry.health -AppId "{ENTRA_CLIENT_ID}"
Test-ApplicationAccessPolicy -Identity trung@foundry.health -AppId "{ENTRA_CLIENT_ID}"
```

And confirm a random other mailbox is denied (should return `AccessDenied`):
```powershell
Test-ApplicationAccessPolicy -Identity {any-other-staff}@foundry.health -AppId "{ENTRA_CLIENT_ID}"
```

The policy can take up to **30 minutes** to propagate. Don't enable the cron until `Test-ApplicationAccessPolicy` returns `AccessDenied` on a non-target mailbox.

### How it works

- **Cursor.** `MailboxPollCursor` Prisma model holds `lastReceivedDateTime` per mailbox. Each poll calls `GET /users/{upn}/messages?$filter=receivedDateTime gt {cursor}&$expand=attachments&$top=50&$orderby=receivedDateTime asc` and advances the watermark to the newest processed `receivedDateTime`. Won't churn through historical mail — initial cursor seeds to "now".
- **Heuristic (cheap filter before OCR tokens).** Sender domain ≠ `@foundry.health`; ≥1 attachment with `application/pdf` or `image/*` mime; subject regex `/invoice|bill|statement|receipt|payable|due|payment/i`; M365 categories `personal` / `private` skipped. Lean false-positive-tolerant.
- **Extraction.** For each candidate, download attachments → `extractIntakeFields` (claude-sonnet, retries × 3 + Zod) → pick highest `confidence.overall` across attachments → match Supplier by ABN then by name (fall back to free-text `supplierName`).
- **Dedupe.** By `(supplierName||supplierId) + supplierInvoiceNumber`. Follow-up reminders from the same vendor for the same invoice number land once.
- **Output.** `Bill { status: pending_review, receivedVia: 'email', originalEmailId: <Graph message id>, supplierName, supplierInvoiceNumber, amountTotal, gst, issueDate, dueDate, category, attachmentSharepointUrl? }` + `Approval` row routed via `resolveRequiredRole('bill', amountCents)` + `AuditEvent` (`source: 'integration_sync'`, delta includes confidence + raw extraction). Same `prisma.$transaction`.
- **Low-confidence handling.** `BillStatus` has no `awaiting_human` value (only `pending_review`/`approved`/`rejected`/`scheduled_for_payment`/`paid`). Low-confidence bills land as `pending_review` like the rest; the admin status page (§Admin) surfaces a 24h counter so reviewers know to spot-check them. This matches the Uber email-intake precedent.

### Foundry-side configuration

- Cron is wired in `vercel.json` at `*/15 * * * *`. Vercel Pro is required (same plan as the Uber cron).
- Per-mailbox enable toggle on `/admin/integrations/mail-intake` (writes `MailboxPollCursor.enabled` + audit event).
- Health check: `/system-status` surfaces "Mail intake" as a component — up when both mailboxes have polled successfully in last 60 min; degraded if one is stale or last poll set `lastError`; down if Graph rejects auth.

### Failure handling

- **Graph 401/403.** Mark `MailboxPollCursor.lastError`; cron loop continues with the other mailbox; admin status page surfaces the error; system-health flips to `degraded`. Common cause: ApplicationAccessPolicy not yet propagated, or Mail.Read consent revoked.
- **OCR failure (all attempts).** Per-message error captured in `lastError`-style audit; message remains processable on next fire because the cursor only advances past *successfully* processed messages. Capped at 3 cursor stalls before surfacing in the admin failures list.
- **Personal mail false-positive.** Heuristic is intentionally loose — if a random PDF gets through, it lands as a Bill `pending_review` with no Supplier match. Admin rejects it from the approvals queue; reject writes audit; no leak to Xero (Bills push to Xero only on approval).
- **Vendor sends duplicate.** Dedupe key blocks; the follow-up email is logged but no Bill row created.
- **Mailbox disabled mid-poll.** Toggle off via admin → cron skips that mailbox on next fire; in-flight processing for the current fire completes.

### Migration plan (`trung@` → `finance@`)

1. Cut the ApplicationAccessPolicy in with both mailboxes from day one (above).
2. Both rows start `enabled: true`.
3. As vendors migrate to `finance@` (TT updates Xero contact emails + sends one-off "please email finance@ in future" replies), the volume in `trung@` decays.
4. Once `trung@` shows zero invoice arrivals for 30 days, TT flips the toggle on the admin page — cursor row stays but cron stops polling.
5. Optionally, drop the `trung@foundry.health` member from the `Foundry Ops Mail Intake` distribution group to fully revoke app access.

---

## Integration health dashboard

On `/admin/integrations`:
- Per-integration: status badge, last sync, auth expiry, recent errors
- "Reconnect" action if token expired
- "Replay failed webhooks" for last 24h

---

## Secrets

All integration secrets in a vault (AWS KMS / Vercel encrypted env / HashiCorp Vault — pick per host). Never in code. Rotate on a 90-day schedule; `RUNBOOK.md` documents the procedure.

---

## Feature flags per integration

Every integration ships behind a flag so staging dogfoods before prod:

- `ENABLE_M365_PROVISIONING`
- `ENABLE_XERO_PUSH` (vs dry-run mode)
- `ENABLE_PAYDOTCOMAU`
- `ENABLE_WHATSAPP_OUTBOUND`
- `ENABLE_WHATSAPP_INBOUND`
- `ENABLE_DOCUSIGN_SEND`
- `ENABLE_TEAMS_NOTIFICATIONS`

Stored in `FeatureFlag` table + env override.
