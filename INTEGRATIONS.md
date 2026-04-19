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
- `Mail.Read` (app, scoped to `bills@` and `receipts@`) — agent triggers
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
| Mail | M365 → app | Agent-driven | `bills@` + `receipts@` inboxes monitored |
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
| `approval_request` | Approval needed for invoice/bill/etc. | `{1}` subject, `{2}` amount, `{3}` deep link |
| `approval_mfa` | MFA challenge for >$20k | `{1}` 6-digit code |
| `timesheet_reminder` | Friday reminder | `{1}` deep link |
| `ar_overdue` | Overdue invoice alert | `{1}` invoice number, `{2}` days, `{3}` link |
| `receipt_intake_instructions` | Onboard: "send a photo to log an expense" | — |

**Inbound auth (for mutating actions):**
- Source number must match a registered Person's `whatsappNumber`
- `YES` / `NO` / `REVIEW` literal matching
- For subjects >$20k: send MFA challenge via `approval_mfa` template; require reply with 6-digit code within 5 min

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
