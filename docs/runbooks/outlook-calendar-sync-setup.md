# Runbook — enable the Outlook → availability sync

**For:** TT / Global Admin. One-time, ~40 minutes plus up to 30 minutes of propagation wait.
**Enables:** TASK-522. Nightly, each person's all-day and out-of-office events fill the days they left blank in `/availability`.
**Code is already deployed and inert** — the `outlook_availability_sync` FeatureFlag is off and the two env vars are unset, so the cron returns `{ skipped }` and writes nothing. Nothing in this runbook is visible to staff until step 7.

Work top to bottom. Every step has a check; if a check fails, stop there rather than continuing.

---

## Before you start

- [ ] You are Global Admin **and** Exchange Administrator on `foundry.health`. Both are needed — the Entra half and the Exchange half are separate.
- [ ] You can reach the Supabase dashboard for the prod project (the DB migration in step 6 goes through the SQL Editor; prod creds aren't usable from a local checkout).
- [ ] Exchange Online PowerShell is available:
  ```powershell
  Install-Module -Name ExchangeOnlineManagement -Scope CurrentUser
  Connect-ExchangeOnline -UserPrincipalName trung@foundry.health
  ```
- [ ] You have `CRON_SECRET` to hand (Vercel → Settings → Environment Variables) for the step 7 smoke test.

### Read this before step 1 — it may change what you do

`New-ApplicationAccessPolicy`, which is what section 7 of `INTEGRATIONS.md` uses to pin `Mail.Read` to the AP-intake mailboxes, is **deprecated**. Microsoft's own cmdlet reference says not to create new policies and that existing ones will need migrating to **RBAC for Applications**. No retirement date has been announced, and the existing mail policy keeps working, but a new scope should not be built on it.

So this runbook uses RBAC for Applications. One consequence worth understanding: under App RBAC, `Calendars.Read` can be scoped independently of `Mail.Read` **on the same app registration**, so the "second app registration" framing in my earlier note was specific to the legacy mechanism. A second registration is still what I'd do here, for one practical reason rather than a forced one: the AP-intake mail scoping is live and working on a legacy policy, and reusing that registration would mean migrating that policy to App RBAC first. That is a change to a working integration, on a different day, with its own verification. A separate registration leaves it entirely alone.

If you would rather consolidate onto one app later, the migration path is to move the Mail.Read restriction to App RBAC and then add a second scoped role assignment. Not now.

---

## Step 1 — Decide who is in scope

The distribution group you create in step 4 **is the opt-in list**. Reading someone's calendar is a consent question and the group is where that consent is recorded. Adding someone turns the sync on for them; removing them turns it off and stops their synced days being refreshed.

- [ ] Write down the list of mailboxes to include. Suggest starting with yourself alone for the first run, then widening once you have seen it work on real data.

> The sync itself iterates every active person with an `@foundry.health` email. Anyone outside the group simply returns a Graph error, gets recorded in `failures[]`, and is skipped — their grid is untouched. So a narrow group is a safe way to pilot.

---

## Step 2 — Create the app registration

Entra admin center → **Microsoft Entra ID** → **App registrations** → **New registration**.

- [ ] Name: `Foundry Ops Calendar Sync`
- [ ] Supported account types: **Single tenant** (Accounts in this organizational directory only)
- [ ] Redirect URI: leave blank — this is a daemon app, there is no sign-in
- [ ] **Register**

Record these from the Overview page:

- [ ] **Application (client) ID** → this is `CALENDAR_ENTRA_CLIENT_ID`
- [ ] **Directory (tenant) ID** → should match the existing `ENTRA_TENANT_ID`. If it doesn't, stop; you are in the wrong tenant.

---

## Step 3 — Grant `Calendars.Read` and consent

Still in the new registration:

- [ ] **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**
- [ ] Search `Calendars.Read`, tick it, **Add permissions**
- [ ] Remove the default `User.Read` delegated permission if present — this app never acts as a user
- [ ] **Grant admin consent for foundry.health**

**Check:** the permissions table shows exactly one row, `Calendars.Read`, Application, status "Granted for foundry.health" with a green tick. If it shows `Calendars.ReadWrite`, remove it — the sync is read-only (Q3) and should not hold write access it will never use.

Now the secret:

- [ ] **Certificates & secrets** → **New client secret** → description `foundry-ops calendar sync`, expiry 24 months
- [ ] Copy the **Value** immediately (not the Secret ID — the Value is shown once and never again) → this is `CALENDAR_ENTRA_CLIENT_SECRET`
- [ ] Put the expiry date in your calendar. When it lapses the sync starts failing silently-ish: every person lands in `failures[]` and grids simply stop updating.

And the object id you will need in step 5:

- [ ] **Microsoft Entra ID** → **Enterprise applications** → search `Foundry Ops Calendar Sync` → open it → copy the **Object ID**.

> This is the gotcha in the whole runbook. The Enterprise application (service principal) Object ID is **not** the same as the App registration's Object ID, and step 5 fails confusingly if you use the wrong one. Take it from Enterprise applications, not App registrations.

---

## Step 4 — Create the scope group in Exchange

```powershell
New-DistributionGroup -Name "Foundry Ops Calendar Sync" `
  -Alias "foundry-ops-calendar-sync" `
  -Type "Security" `
  -PrimarySmtpAddress "foundry-ops-calendar-sync@foundry.health" `
  -Members @("trung@foundry.health")
```

- [ ] Run it, substituting your step 1 list for `-Members`.
- [ ] Grab the distinguished name, which the management scope needs:
  ```powershell
  (Get-DistributionGroup "Foundry Ops Calendar Sync").DistinguishedName
  ```

**Check:** `Get-DistributionGroupMember "Foundry Ops Calendar Sync"` lists exactly the people you intended.

---

## Step 5 — Grant the scoped role (RBAC for Applications)

Three cmdlets: register the service principal with Exchange, define the scope, assign the role.

```powershell
# 5a — tell Exchange about the app. ObjectId is the ENTERPRISE APPLICATION
# object id from step 3, not the app registration's.
New-ServicePrincipal `
  -AppId "<CALENDAR_ENTRA_CLIENT_ID>" `
  -ObjectId "<enterprise application Object ID>" `
  -DisplayName "Foundry Ops Calendar Sync"
```

```powershell
# 5b — limit it to the group's members.
New-ManagementScope `
  -Name "Foundry Ops Calendar Sync Scope" `
  -RecipientRestrictionFilter "MemberOfGroup -eq '<DistinguishedName from step 4>'"
```

```powershell
# 5c — confirm the role name exists before using it, then assign.
Get-ManagementRole "Application Calendars*"

New-ManagementRoleAssignment `
  -App "<CALENDAR_ENTRA_CLIENT_ID>" `
  -Role "Application Calendars.Read" `
  -CustomResourceScope "Foundry Ops Calendar Sync Scope"
```

- [ ] `-CustomResourceScope` must match the `-Name` in 5b character for character. A mismatch is the most common failure here.

**Check** — simulate what the app can reach. Someone in the group should be allowed, someone outside denied:

```powershell
Test-ServicePrincipalAuthorization -Identity "Foundry Ops Calendar Sync" -Resource "trung@foundry.health"
Test-ServicePrincipalAuthorization -Identity "Foundry Ops Calendar Sync" -Resource "<someone-not-in-the-group>@foundry.health"
```

- [ ] First returns the `Application Calendars.Read` role as in scope; second does not.
- [ ] **Wait for propagation before trusting a negative result** — allow up to 30 minutes. A denial five minutes in means nothing.

**Also check the mail side is untouched.** The two registrations are independent, but this is exactly the interaction worth re-confirming by hand:

```powershell
Test-ApplicationAccessPolicy -Identity finance@foundry.health -AppId "<ENTRA_CLIENT_ID>"   # AccessAllowed
```

---

## Step 6 — Apply the database migration

`AvailabilityForecast.source` does not exist in prod yet. Nothing auto-runs `prisma migrate deploy` here, and **`/availability` will error on the missing column once the deployed code expects it** — so this step is not optional and is not safe to defer.

- [ ] Open the prod project in the Supabase dashboard → **SQL Editor**
- [ ] Paste and run the contents of `prisma/migrations/20261023120000_availability_forecast_source/migration.sql`:
  ```sql
  CREATE TYPE "AvailabilitySource" AS ENUM ('human', 'outlook');

  ALTER TABLE "AvailabilityForecast"
    ADD COLUMN "source" "AvailabilitySource" NOT NULL DEFAULT 'human';
  ```

**Check:**
```sql
select source, count(*) from "AvailabilityForecast" group by source;
```
- [ ] Every existing row reads `human`. That is correct — until the sync runs, every forecast in the system was typed by a person.

---

## Step 7 — Pilot on staging

- [ ] Vercel → the **staging** project → Settings → Environment Variables → add `CALENDAR_ENTRA_CLIENT_ID` and `CALENDAR_ENTRA_CLIENT_SECRET` (mark the secret as sensitive). Redeploy so they're picked up.
- [ ] Turn the flag on:
  ```sql
  insert into "FeatureFlag" (key, enabled, description)
  values ('outlook_availability_sync', true, 'Outlook calendar -> availability forecast (TASK-522)')
  on conflict (key) do update set enabled = true;
  ```
- [ ] Trigger a run by hand rather than waiting for 06:00:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://<staging-host>/api/cron/outlook-availability-sync
  ```

**Check the response body, not just the status code.** You want something like:

```json
{"peopleConsidered":12,"peopleChanged":1,"daysWritten":3,"daysDeleted":0,"daysSkippedHuman":0,"failures":[...]}
```

- [ ] `peopleChanged` is at most the size of your group. If it's larger, the scope is not applied — stop and re-check step 5.
- [ ] `failures[]` contains everyone outside the group. That is expected and correct, not a problem to fix.
- [ ] `daysWritten` matches leave you can actually point at in your own calendar.
- [ ] Open `/availability` and confirm the synced days carry a `cal` badge, and that typing over one clears the badge.
- [ ] Run the curl a **second time**. `daysWritten` should drop to 0 — the sync is idempotent and a no-op day is skipped. If the second run rewrites the same days, something is wrong with the comparison; stop.

---

## Step 8 — Production

Only once step 7 is clean on real calendar data.

- [ ] Add the same two env vars to the **production** Vercel project, redeploy
- [ ] Run the same `FeatureFlag` upsert against prod
- [ ] Trigger one manual run and read the response as in step 7
- [ ] Tell the team, in one line: their leave will start appearing in `/availability`, days marked `cal` came from Outlook, and typing over one makes it theirs permanently

The nightly cron is already registered in `vercel.json` at `0 19 * * *` UTC — 06:00 AEDT, ahead of the morning resourcing conversation.

---

## Rolling it back

Fastest, no deploy needed:

```sql
update "FeatureFlag" set enabled = false where key = 'outlook_availability_sync';
```

That stops all future writes. It does **not** remove rows already written. To clear those as well:

```sql
delete from "AvailabilityForecast" where source = 'outlook';
```

That is safe by construction — anything a person typed is `human` and is untouched by that delete. It is the reason the provenance column exists.

To revoke access entirely: `Remove-ManagementRoleAssignment` for the assignment in 5c, or delete the app registration.

---

## Troubleshooting

| What you see | Most likely cause |
|---|---|
| `{"skipped":"outlook_availability_sync flag off"}` | Step 7's `FeatureFlag` upsert didn't run against this environment |
| Every person in `failures[]` with `403` | Role assignment missing or still propagating, or the secret is wrong. Re-run `Test-ServicePrincipalAuthorization` |
| Every person in `failures[]` with `401` | `CALENDAR_ENTRA_CLIENT_SECRET` holds the Secret **ID** rather than the Value, or the secret has expired |
| `peopleChanged` covers the whole firm | `-CustomResourceScope` doesn't match the scope name, so the assignment is unscoped. Treat as urgent |
| `New-ServicePrincipal` rejects the ObjectId | You used the App registration's Object ID instead of the Enterprise application's |
| Someone's day shows 0h and they disagree | Check the AuditEvent — the sync records the event subjects behind every day it writes. `entityType = 'availability_forecast'`, `actorType = 'system'` |
| A whole day zeroed by a birthday or holiday-feed entry | An all-day event not marked `free`. `blocksAvailability()` in `src/server/integrations/outlook-calendar.ts` is the line that decides this |
| Nothing is written although leave exists | The leave is marked `busy` rather than `oof` and isn't all-day. By design (Q1) — a busy block never reduces availability |

---

## What this does not do

- **Does not write to anyone's calendar.** Read-only, Q3. The only Graph verb in the integration is `GET`.
- **Does not overwrite a forecast a person typed.** Q2. A `human` row is skipped whatever the calendar says.
- **Does not treat an unreadable calendar as free time.** A person whose calendar can't be read is skipped and their grid keeps what they last saved. This is the single failure mode that would do real damage, and it is the one thing the design protects hardest.
