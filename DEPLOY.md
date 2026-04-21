# Foundry Ops — prod deploy checklist

One-page reference for pushing Foundry Ops to Vercel + configuring the
external systems it talks to. Read this in order.

## 1. Env vars — sync to Vercel

Open **Vercel → Project Settings → Environment Variables**. Copy each value
from `.env.local` into Production (tick Production scope only unless you
explicitly want it in Preview too).

### Required for the app to boot

| Var                         | Value                                                            |
|-----------------------------|------------------------------------------------------------------|
| `NEXT_PUBLIC_APP_URL`       | `https://foundry-ops.vercel.app` (swap for custom domain later)  |
| `AUTH_SECRET`               | `openssl rand -base64 32`                                        |
| `NEXTAUTH_URL`              | Same as `NEXT_PUBLIC_APP_URL`                                    |
| `DATABASE_URL`              | Supabase pooled (Supavisor) connection string                    |
| `DIRECT_URL`                | Supabase direct connection string (for `prisma migrate`)         |
| `ENTRA_TENANT_ID`           | From Entra app registration                                      |
| `ENTRA_CLIENT_ID`           | From Entra app registration                                      |
| `ENTRA_CLIENT_SECRET`       | Secret **Value** (not Secret ID)                                 |
| `RESEND_API_KEY`            | Rotated; paste without the `re_` prefix stripped                 |
| `EMAIL_FROM`                | `auth@foundry.health` (or verified domain address)               |

### Xero

| Var                     | Value                                                             |
|-------------------------|-------------------------------------------------------------------|
| `XERO_CLIENT_ID`        | From dev portal → App details                                     |
| `XERO_CLIENT_SECRET`    | From dev portal → App details (generate if needed)                |
| `XERO_WEBHOOK_KEY`      | From dev portal → **Webhooks** tab (also needed for prod)         |
| `XERO_SALES_ACCOUNT_CODE`    | Optional — defaults to org default (e.g. `200`)              |
| `XERO_EXPENSE_ACCOUNT_CODE`  | Optional                                                     |

### SharePoint / M365

| Var                                 | Value                                                |
|-------------------------------------|------------------------------------------------------|
| `SHAREPOINT_SITE_URL`               | e.g. `https://foundryhealth.sharepoint.com/sites/...` |
| `SHAREPOINT_CLIENTS_ROOT`           | `CORPORATE/TEAM ACCESS/01 Client Projects/01 Active Clients` |
| `SHAREPOINT_ADMIN_ROOT`             | `CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/02 Project Administration` |
| `SHAREPOINT_TEAM_TEMPLATE_PATH`     | Full path to the "[COPY THIS TO EVERY NEW PROJECT CODE]" template |

### Cron

| Var           | Value                              |
|---------------|------------------------------------|
| `CRON_SECRET` | `openssl rand -base64 32` — Vercel Cron sends this as `Authorization: Bearer …` |

### ABA (only needed when a pay-run is actually exported)

| Var                    | Source                                                      |
|------------------------|-------------------------------------------------------------|
| `ABA_USER_BSB`         | Foundry's CBA account BSB (source of pay-runs)              |
| `ABA_USER_ACCOUNT`     | Foundry's CBA account number                                |
| `ABA_USER_ID`          | 6-digit APCA user ID — from CBA relationship manager        |
| `ABA_USER_NAME`        | `FOUNDRY HEALTH PTY LTD` (max 26 chars in ABA spec)         |
| `ABA_BANK_ABBREV`      | `CBA`                                                       |
| `ABA_REMITTER_NAME`    | `FOUNDRY HEALTH` (max 16 chars on payee's statement)        |

---

## 2. External integration config

### Entra ID (Microsoft)

- Redirect URI in Entra app → `https://foundry-ops.vercel.app/api/auth/callback/microsoft-entra-id`
- Add the prod URL to the app's allow-list; the localhost one stays for dev.

### Xero

- Dev portal → Configuration → **Redirect URIs**
  - Add `https://foundry-ops.vercel.app/api/integrations/xero/callback`
- Dev portal → **Webhooks** tab
  - URL: `https://foundry-ops.vercel.app/api/integrations/xero/webhook`
  - Events: Invoices, Contacts (Contacts off for MVP since we don't sync)
  - Copy the signing key → `XERO_WEBHOOK_KEY` in Vercel env
  - Hit **Save & send intent-to-receive**. Status should flip to **OK**.

### Resend

- Domain verified for `foundry.health` (DKIM/SPF records in DNS).
- `EMAIL_FROM` must match the verified sender.
- Rotate `RESEND_API_KEY` periodically; the old value shouldn't exist anywhere
  except `.env.local`.

### Vercel Cron

`vercel.json` ships with the cron schedule. Post-deploy, verify at
**Vercel → Project → Cron** that `/api/cron/xero-bank-pull` is scheduled
for `30 17 * * *`.

---

## 3. Deploy steps

1. Confirm `main` is green on CI.
2. Vercel → **Deployments** → Promote latest `main` preview → **Production**.
   (Or push to `main` if auto-deploy is on.)
3. Wait for the deploy to complete.

---

## 4. Post-deploy smoke tests

Run through these in order. Each should take <1 minute.

1. **Sign-in redirects**: open `https://foundry-ops.vercel.app/` — expect redirect to Entra SSO.
2. **Auth complete**: sign in as you. Dashboard renders, your name shows in the sidebar.
3. **Healthz**: `https://foundry-ops.vercel.app/healthz` → 200 + `db: up`.
4. **Xero connected**: `/admin/integrations/xero` → Connected badge (re-run connect if needed).
5. **Xero webhook**: in the Xero dev portal, hit **Send intent to receive** — status shows **OK**.
6. **Email diagnostic**:
   ```bash
   curl -X POST https://foundry-ops.vercel.app/api/admin/email/test \
     -H 'content-type: application/json' \
     -H 'cookie: <your session cookie>' \
     -d '{"to":"trung@foundry.health"}'
   ```
   Expect `{ok: true, resendId: "..."}`. Email arrives within ~10 seconds.
7. **SharePoint**: `/admin/integrations` → SharePoint card shows site + roots.
8. **Cron**: wait 24h OR manually fire
   `curl -H "Authorization: Bearer $CRON_SECRET" https://foundry-ops.vercel.app/api/cron/xero-bank-pull` — 200 ok.

---

## 5. Rollback

If something goes wrong:

- Vercel → **Deployments** → previous production deploy → **Promote to Production**. Rollback is instant.
- DB migrations roll forward only — if a bad migration lands, **restore Supabase from point-in-time backup** (Supabase → Project → Backups → Restore), then re-promote the last known-good deploy.

---

## 6. Known gaps at deploy time

These are deliberately stubbed — wire them when you need them:

- **Agent workflows** (TASK-080 onward) — Inngest not set up yet. Agent queues will no-op.
- **WhatsApp** (TASK-120) — no webhook, no outbound. `ENABLE_WHATSAPP_*` flags off.
- **DocuSign** (TASK-130) — contract signing not live.
- **pay.com.au** — ABA export works; the upload-to-pay.com.au step is still manual.
