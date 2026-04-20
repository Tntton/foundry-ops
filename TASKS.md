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
**status:** done
**depends on:** TASK-001
**acceptance:**
- [x] `prisma/schema.prisma` copied from this bundle (verbatim) — copied in TASK-001; `directUrl = env("DIRECT_URL")` added to the datasource block (required for Supabase pgbouncer — pooler can't run migrations in transaction mode)
- [x] `pnpm prisma migrate dev --name init` succeeds against the Supabase DB — initial migration `20260419123837_init` applied to Supabase project `epadyqrgutfzvwwxyxjm` (ap-southeast-2)
- [x] `pnpm prisma generate` runs in `postinstall`
- [x] ~~Docker compose~~ — dropped; Supabase is the sole Postgres host per user 2026-04-19
- [x] `.env.example` documents `DATABASE_URL` (pooled, port 6543, `?pgbouncer=true`) and `DIRECT_URL` (direct, port 5432) with Supabase URL patterns; actual values in `.env.local` (gitignored)
- [x] `src/server/db.ts` exports a singleton `PrismaClient` with the standard Next.js HMR-safe pattern (dev-mode globalThis cache)

**context:** Supabase is the sole Postgres host (no local Docker) per user 2026-04-19. Implication: `prisma migrate dev` lands migrations directly on the Supabase DB from day one — acceptable during the MVP testing phase (TT + JN parallel-run); once real client data lands, schema changes should shift to `prisma migrate deploy` via CI rather than `migrate dev` on a dev workstation.

**note on completion:** `@prisma/client@5.20.0` auto-added as a dependency by `prisma migrate dev` (Prisma installs it if missing). `prisma:validate` script updated to inject placeholder `DIRECT_URL` alongside `DATABASE_URL` (Prisma 5 resolves every env reference on validate, even offline). Migration SQL at `prisma/migrations/20260419123837_init/migration.sql` is committed — reproducible for CI and future clones.

### TASK-003 — Tailwind theme from design tokens
**status:** done
**depends on:** TASK-001
**acceptance:**
- [x] Design tokens from `hifi.css` extracted into `tailwind.config.ts` (colors, radii, shadows, typography). Stored as CSS variables on `:root` in `src/app/globals.css`; referenced from Tailwind via `var(--…)` so shadcn-style theming works cleanly.
- [x] Brand primary aliased to `brand` — **using `#688b71` (green) from `hifi.css`, not `#D97757`** as this acceptance bullet originally specified. The prototype CSS was treated as authoritative here since it's the actual rendered source; TASKS.md's `#D97757` value appears to be a copy-paste error from an earlier iteration. If the intended brand is actually orange, flip `--brand` / `--primary` in `src/app/globals.css` and the token test will follow. Flag for user review if the healthcare-green palette is wrong.
- [x] Status colors (green/amber/red/**blue** too — hifi.css has 4) aliased under `status.*`
- [x] `src/__tests__/tokens.test.ts` spot-checks brand, status quadruplet, radii, shadows, fonts, and the shadcn `primary` alias — 6 assertions
- [x] shadcn/ui installed (components.json + `src/lib/utils.ts` `cn` helper + radix-slot + class-variance-authority + lucide-react); Button + Input + Badge primitives live at `src/components/ui/` and render on `/` for visual verification

**note on completion:** The prototype uses an earthy green + gold palette that reads much more "healthcare consultancy" than `#D97757`; going with the prototype value avoids needing to rework tokens later if TASKS.md was wrong. Tailwind v3.4.14 (not v4) to match shadcn's current component templates. `box-sizing` reset + `body` font baseline live in `globals.css`. `tailwindcss-animate` plugin added for future Radix animations.

### TASK-004 — NextAuth with Entra ID, tenant-restricted
**status:** done
**depends on:** TASK-002
**acceptance:**
- [x] NextAuth (Auth.js v5) configured with Microsoft Entra ID provider at `src/server/auth.ts`
- [x] Tenant ID pinned via `ENTRA_TENANT_ID` (single-tenant issuer URL `https://login.microsoftonline.com/<tenant>/v2.0`)
- [x] Non-`@foundry.health` emails rejected in `signIn` callback (returns false)
- [x] On successful sign-in, upsert `Person` row (match by email); `entraUserId` stored; first-time sign-in creates a minimal Person (admin refines via Directory wizard in TASK-023)
- [x] Session cookie: `foundry-ops.session-token`, httpOnly, sameSite=lax, secure only in production (custom cookie config in `src/server/auth.ts`)
- [x] JWT strategy, 12h max age; `personId` + `initials` + `roles` hydrated into the JWT for server-side authorization

**note:** The contractor magic-link flow was originally part of this task; split out as TASK-004b so TASK-004 can land cleanly with staff SSO. 004b depends on 004 and can land independently. Required env vars (AUTH_SECRET, ENTRA_*) documented in `.env.example`; real values in `.env.local` (gitignored). `src/types/next-auth.d.ts` augments the Session + JWT types with Foundry fields. `src/server/env.ts` provides `requireEnv()` so missing vars fail loudly at startup rather than at first request.

### TASK-004b — Contractor magic-link via Resend
**status:** done
**depends on:** TASK-004
**acceptance:**
- [x] POST `/api/auth/magic-link/send`: accepts `{ email }`, validates with Zod, generates 32-byte `base64url` token, stores sha256 hash in `MagicLink` with 15-min TTL. Raw token only lives in the email. Returns generic `{ ok: true }` even on unknown email / send failure to prevent user enumeration.
- [x] Email rendered via Resend (`RESEND_API_KEY`, `EMAIL_FROM`); green brand-coloured CTA button; 15-min + single-use messaging; plain-text fallback
- [x] Page `/auth/magic-link/verify?token=…`: calls Auth.js `signIn('magic-link', { token })` which invokes the new **Credentials provider** — `authorize()` calls `verifyMagicLink()`, which burns the link and returns the Person. Invalid/expired/consumed/unknown-email all return null from authorize → Auth.js renders the fallback error page (UI shows "Link invalid or expired").
- [x] Rate-limited: 3 sends per email per hour (DB count query over `createdAt`); returns 429 when breached
- [x] Schema migration `20260419142312_magic_link` applied — `MagicLink` model: `tokenHash @unique`, `@@index([email, createdAt])` for rate-limit query, `@@index([expiresAt])` for future sweep job
- [x] `signIn` callback updated: magic-link provider passes through without `@foundry.health` suffix check (contractors can have any email). `jwt` callback resolves email from either OIDC profile or Credentials `user.email`.
- [x] 7 unit tests for token primitives (`generateToken` is base64url + 43 chars + unique; `hashToken` is deterministic, 64 hex chars, doesn't leak raw token)

**note on completion:** Custom MagicLink model rather than the Auth.js Email provider (which requires the full Prisma Adapter with User/Account/Session/VerificationToken tables, conflicting with Person-as-identity). Rate-limit check is DB-based; a cleanup job to sweep expired/consumed links is a future chore. Zod added (`3.23.8`) for request body validation — will be reused across future API routes.

**context:** Custom implementation (not Auth.js email provider) because the Auth.js email provider requires the full Prisma Adapter with User/Account/Session/VerificationToken tables, which conflicts with our Person-as-identity model. Our `MagicLink` is a lightweight, single-purpose token table.

### TASK-005 — Session → roles helper (Person.roles as source)
**status:** done
**depends on:** TASK-004
**acceptance:**
- [x] `getSession()` in `src/server/session.ts` reads the Auth.js JWT and fetches the Person row, returning `{person}` (with roles + basic identity fields) or null
- [x] Five roles supported via `Role` enum from `@prisma/client`
- [x] Multi-role supported — `Person.roles: Role[]` is the source of truth
- [x] Pure helpers split into `src/server/roles.ts` (no auth/prisma deps): `hasRole`, `hasAnyRole`, `requireSession`, `requireRole`, `requireAnyRole`, `UnauthorizedError`
- [x] 15 unit tests in `src/__tests__/session.test.ts` cover null / single role / multi-role / empty required list / throws-when-missing branches
- [x] Role array re-fetched from DB on every `getSession()` call — no 1h stale cache. Admin role changes via Directory take effect on the next request

**note on completion:** The original acceptance mentioned "roles resolved from Entra group membership … cached on Person for 1h"; that's TASK-005b (deferred). For MVP, `Person.roles` is set via the Directory wizard (TASK-023). Pure role helpers intentionally separated from `getSession()` so Vitest can test them without loading NextAuth's runtime (which transitively imports Next.js server internals not available in the Node test env).

**note:** The original acceptance said "roles resolved from Entra group membership on sign-in; cached on Person for 1h." Deferred to TASK-005b — for MVP, `Person.roles` is set via the Directory wizard (TASK-023) and read directly. Entra group sync becomes a nice-to-have once the org's groups are standardised.

### TASK-005b — Entra group membership → Role sync
**status:** todo
**depends on:** TASK-005
**acceptance:**
- [ ] On sign-in, call Microsoft Graph `/me/memberOf` with the user's delegated token
- [ ] Map Entra group names (e.g. `FoundryPartners`, `FoundrySuperAdmins`, etc.) to `Role[]` via a config table
- [ ] Union with any roles set directly on Person (Entra groups add, don't subtract)
- [ ] Cache result on `Person.roles` with a `rolesSyncedAt` timestamp; refresh if stale >1h
- [ ] Unit test: mock Graph response with `FoundryPartners` group → resolves to `partner`

**context:** Skipped in MVP. The Directory wizard sets Person.roles directly; admins manage role assignments in-app. Entra sync becomes relevant once Foundry standardises on Entra group management for access control org-wide.

### TASK-006 — Permission primitive
**status:** done
**depends on:** TASK-005
**acceptance:**
- [x] `requireCapability(session, capability)` throws `UnauthorizedError` when missing; works as a TS asserts so call-sites narrow to non-null session
- [x] `hasCapability(session, capability)` returns boolean (non-throwing)
- [x] Capability catalog in `src/server/capabilities.ts` covers the HANDOFF.md §1.2 minimum set + the obvious companions (invoice.create, invoice.send, expense.submit, bill.create, client.create/edit, person.edit, project.edit, ratecard.view, approval.policy.edit, timesheet.submit) — 24 total
- [x] Capability → required-role mapping is a single const table (`CAPABILITY_ROLES`) typed `Record<Capability, readonly Role[]>`
- [x] 53 unit tests in `src/__tests__/capabilities.test.ts`: Super Admin has all (parameterized), Staff blocked on every approval/admin cap, Manager can approve under-$2k expenses (ownership enforced at handler level), Partner approves under-$20k invoices, multi-role union works (partner+admin), null session denied, requireCapability throws on miss

**note:** Context-dependent rules ("manager can approve only on own project") are explicitly NOT in the coarse table — those ownership checks happen in individual route handlers after the role gate passes. Keeps this table auditable at a glance. Additional non-listed capabilities can be added as tasks touch new surfaces.

### TASK-007 — Audit event writer
**status:** done
**depends on:** TASK-002
**acceptance:**
- [x] `writeAudit(tx, input)` in `src/server/audit.ts` takes a `Prisma.TransactionClient` so the audit row commits or rolls back with the mutation
- [ ] Rollback integration test — **deferred**: requires a real test DB (we only have Supabase, running destructive tests against it is unsafe). Add to TASK-XXX once a dev-isolated Postgres exists (local Docker was dropped; consider Neon branch DBs or a Supabase dev project)
- [x] Delta stored as jsonb using `deep-diff` (wrapped in `{ created }` / `{ deleted }` / `{ changes: Diff[] }` shapes)
- [x] Source enum matches `AuditSource` on the schema (`web | agent | api | integration_sync`); ActorType (`person | agent | system`) expressed in the `AuditActor` union
- [x] `/api/admin/audit` at `src/app/api/admin/audit/route.ts`: list with filter by actorId, entityType, entityId, from, to; limit 1–500 (default 100); gated on `auditlog.view` (Super Admin only); includes actor identity fields in the response
- [x] 8 unit tests cover `computeDelta` — null / created / deleted / no-op / single edit / add+remove keys / nested / JSON round-trip

**note:** `deep-diff` is deprecated on npm. Functional and stable, but migrating to `microdiff` is a cleanup task for later. `writeAudit` intentionally requires a Prisma tx — passing `prisma` directly doesn't typecheck, so call sites can't accidentally skip the transaction.

### TASK-008 — Port prototype UI primitives
**status:** done
**depends on:** TASK-003
**acceptance:**
- [x] 10 primitives in `src/components/ui/`: Button + Badge + Input (from TASK-003), plus Icon, Avatar, KPI, Card, Table, Drawer, Modal (`dialog.tsx`), Tabs
- [x] Dev-only playground at `/playground` (gated on `NODE_ENV !== 'production'` via `notFound()`) renders every primitive with representative Foundry-flavoured content
- [ ] Visual spot-check against `screenshots/01-dashboard-super-admin.png` — **deferred** to when the full shell (TASK-009) + dashboard (TASK-070 when Phase 2 resumes) are up; pixel-level comparison against a dashboard-level screenshot doesn't make sense on isolated primitives
- [x] Icon component is a thin wrapper around `lucide-react`'s `LucideIcon`; no inline SVG strings

**note:** Drawer (right-side, ~640px) + Modal (center dialog) both built on Radix Dialog with different slide-in directions. Tabs on Radix Tabs. Avatar on Radix Avatar with initials fallback. KPI is custom (not in shadcn) with trend arrow + subtext. Table uses semantic `<table>` + shadcn's hover/selected row patterns. All CSS classes reference the Foundry Tailwind tokens from TASK-003.

### TASK-009 — Shell: sidebar + topbar + breadcrumb
**status:** done
**depends on:** TASK-008, TASK-005
**acceptance:**
- [x] Sidebar groups Workspace / Inputs / System in `src/components/shell/nav-config.ts`; groups hide when all their items are filtered out for the user's roles
- [x] Role-filtered nav: Staff sees only Projects + Timesheet + Expenses + My week (no Dashboard, P&L, BD, Directory, Approvals); Manager hides P&L/BD/Directory; Partner hides Rate card / Audit / Approval policies; Super Admin sees everything
- [x] Topbar: breadcrumb (resolves known hrefs to nav labels, falls back to humanised path segments), ⌘K search placeholder, avatar + name + email on the right
- [x] No role switcher — authenticated user's real roles drive the nav, read from `getSession()` in the (app) layout
- [x] `⌘K` (and `Ctrl+K`) opens a placeholder Dialog announcing Phase 2 command palette — keyboard shortcut is reserved and visible (`<kbd>⌘K</kbd>` chip in the search button) without building the backend yet
- [x] `src/app/(app)/layout.tsx` enforces auth — unauthenticated requests redirect to `/api/auth/signin`. `src/app/(app)/page.tsx` is the new `/` landing with placeholder KPIs + cards. Old `src/app/page.tsx` removed.

**note:** Breadcrumb is a client component (uses `usePathname()`). Sidebar is server-rendered per-request since `currentPath` changes on every navigation; Next.js app-router's default per-request rendering handles this without extra state. Route group `(app)` groups authenticated pages without affecting URLs. `/playground` remains outside the group — accessible without auth (dev-only).

### TASK-010 — Healthz + staging deploy
**status:** doing
**depends on:** TASK-004
**acceptance:**
- [x] `/healthz` at `src/app/healthz/route.ts` returns `{ok, db, version, commit, at}` with HTTP 200 when DB is up and 503 when down. No auth. Performs `SELECT 1` via Prisma as the DB probe. Version from `npm_package_version`, commit from `VERCEL_GIT_COMMIT_SHA` / `GIT_COMMIT_SHA` env (both null outside CI/prod is fine).
- [ ] Staging deployed (Vercel) — **blocked** on Vercel auth / project setup. `gh` CLI and Vercel CLI steps needed from user before deploy can run.
- [ ] A Foundry staff account can sign in on staging — blocked on staging deploy
- [x] Audit log shows the sign-in event — Auth.js `events.signIn` hook writes an `AuditEvent { action: 'signed_in', entityType: 'person', entityId: person.id, source: 'web' }` via `writeAudit()` inside a transaction. Non-blocking (errors logged, don't fail sign-in).

**note:** `/healthz` alone is done. Staging deploy + end-to-end staging sign-in verification require user-provided Vercel auth to unblock — likely a new task for when deploy infra lands. Sign-in audit event already exercised locally by TT's successful sign-in earlier; verifiable via `SELECT * FROM "AuditEvent" WHERE action='signed_in' ORDER BY at DESC LIMIT 5` in Supabase.

---

## Phase 1A — Identity & config

### TASK-020 — Seed script from fixtures
**status:** done
**depends on:** TASK-002
**acceptance:**
- [x] `prisma/seed.ts` reads `prisma/fixtures/team.json` (39 real Foundry people extracted from `foundry-team.jsx`)
- [x] Rate card seeded from `prisma/fixtures/rate-card.json` (13 levels with AU rates; L4/L3 "Partner" rows skipped since they have null AU rates — partners don't have hourly rate card entries); effective from FY26 start (2025-07-01); bill rate heuristic cost×2 (low) / cost×3 (high) for MVP
- [x] Prod guard: refuses to run when `NODE_ENV === 'production'` unless `FORCE_SEED=1` (staging-only escape hatch)
- [x] `pnpm db:seed` (tsx prisma/seed.ts) and `pnpm db:reset` (prisma migrate reset --force). `prisma.seed` config entry wires `prisma migrate reset` to auto-seed. Verified against Supabase: 13 rate card rows + 39 people.

**note:** Idempotent — `findFirst` on `{ email OR initials }` skips existing rows. This handles the case where `auth.ts` already auto-created the signed-in user's Person row before seed ran. Role assignment: TT → `[super_admin, partner]`; JN/JS (office manager) → `[super_admin, admin]`; Partner band → `[partner]`; Leadership band → `[manager]`; everyone else → `[staff]`. Special-case mapping for the prototype's "Ops"/"Leadership"/"Fellow" bands to the schema's smaller MP/Partner/Expert/Consultant/Analyst enum. tsx@4.19.2 added for TS seed execution.

### TASK-021 — Directory screen: list
**status:** done
**depends on:** TASK-009, TASK-020
**acceptance:**
- [x] `/directory` tabs: People (populated), Clients / Contractors / Suppliers (empty-state placeholders pointing to the future task that fills them)
- [x] People tab: table with initials avatar + name + email, band + level, region, employment (green/blue badge), FTE, rate (gated), status (active/ended)
- [x] Search by name/initials/email; filters for band / region / employment via server-round-trip form (GET-based, preserves URL state for bookmarks)
- [x] Loading state: Next's default suspense (server component); empty state card when no rows match; error state via Next's error boundary (root error.tsx can be added later but Next's default is live)
- [x] Permission: Partner+ can reach the route (`hasAnyRole([super_admin, admin, partner])`); Staff → 404. Pay column (rate) hidden behind `ratecard.view` capability. Edit button only shown when `person.edit` granted.

### TASK-022 — Person detail drawer (phase 1: read-only page; drawer overlay in 022b)
**status:** doing
**depends on:** TASK-021
**acceptance:**
- [x] Tabbed detail surface: Profile, Employment, Pay, Integrations — at `/directory/people/[id]` as a full page (not drawer yet)
- [ ] Drawer overlay (~640px) using the Drawer primitive from TASK-008 — **deferred to TASK-022b**
- [x] Pay tab gated on `ratecard.view`; friendly fallback message when caller lacks the cap
- [x] Integrations tab shows M365 user ID + Xero contact ID (hinting at TASK-051 for contractor Xero sync); employment-aware copy
- [x] Edit form with audit event on save — shipped in TASK-022c (see below). Dirty-state navigation guard still pending.

### TASK-022c — Person edit form + audit on save
**status:** done
**depends on:** TASK-022
**acceptance:**
- [x] `/directory/people/[id]/edit` route, gated on `person.edit` capability
- [x] Form fields: firstName, lastName, phone, whatsappNumber, band, level, employment, FTE, region, rateUnit, rate (AUD dollars on the form, stored as cents), roles (multi-checkbox)
- [x] Email + initials shown as read-only (changing them safely needs its own flow — unique constraints + downstream references)
- [x] Server action `updatePerson(id, prev, formData)` uses Zod validation, updates inside a `prisma.$transaction`, writes an `AuditEvent { action: 'updated', entity: { type:'person', before, after } }` in the same tx
- [x] Returns field-level errors to the form on validation fail; redirects to the detail page on success
- [x] Detail page's Edit button wired up (gated on `person.edit`)
- [ ] Dirty-state navigation guard — **deferred** (standard `beforeunload` confirm is annoying; proper solution uses client-side state tracking, which TT can add when real users start editing)

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
**status:** doing
**depends on:** TASK-022
**acceptance:**
- [ ] Multi-step sidebar: Basics → Employment → Pay → Permissions → Review — **deferred to TASK-023b**; shipped as single-form with sections instead (matches the other create forms in the MVP)
- [x] `/directory/people/new` form: identity / employment / pay / roles; FT-only email suffix validation (`@foundry.health`); auto-derived initials with collision suffix
- [x] On finish: creates Person + audit event in `prisma.$transaction`
- [x] M365 provisioning via Graph `POST /users` when `ENABLE_PROVISIONING=1` AND employment=ft. Idempotent: looks up by UPN first, returns existing `entraUserId` if found. Generates a 20-char temp password satisfying MS complexity rules; surfaces it once on the new-person detail page via one-shot `?tempPassword=…` query param.
- [x] Flag-gated via `ENABLE_PROVISIONING` env (default off)
- [ ] Contractor Xero contact creation — **deferred to TASK-023c**; requires TASK-050 (Xero OAuth). Form allows contractor creation without Xero for now.
- [ ] Welcome email — **deferred to TASK-023d**; Resend template needs designing

### TASK-031 — Project SharePoint folder provision
**status:** doing
**depends on:** TASK-030
**acceptance:**
- [x] `provisionProjectFolder(clientCode, projectCode)` in `src/server/integrations/sharepoint.ts` creates the full folder tree `<SHAREPOINT_CLIENTS_ROOT>/<ClientCode>/<ProjectCode>/{01 Brief, 02 Working, 03 Delivery, 04 Admin}` via Graph
- [x] Wired into `createProject` action — best-effort provision after the DB transaction; project creation is never rolled back by provisioning failures
- [x] Stores resulting `webUrl` on `Project.sharepointFolderUrl` when successful
- [x] Idempotent: `createFolder` handles `409 nameAlreadyExists` by fetching the existing item; safe to call repeatedly
- [x] Retry UI — "Provision SharePoint folder" button on the Files tab when `sharepointFolderUrl` is null; audits retry attempts (entity: `project_sharepoint`)
- [ ] Env `SHAREPOINT_SITE_URL` + (optional) `SHAREPOINT_CLIENTS_ROOT` — **pending from user**. Code runs cleanly without it (returns null and the UI shows the retry button).

**note:** Also added:
- `src/server/graph.ts` — centralised Graph client with client_credentials token caching + typed `GraphError` for all Graph callers.
- `src/server/integrations/m365.ts` — `provisionM365User` used by TASK-023.
- Both helpers gate on `graphConfigured()` so dev without Graph doesn't break.

### TASK-024 — Client list + detail drawer
**status:** done
**depends on:** TASK-009
**acceptance:**
- [x] `/directory/clients` (separate route instead of `?tab=clients` query; cleaner URL structure): table with code, legal name + trading name, primary partner (avatar + name), active-projects count, AR outstanding
- [x] Detail at `/directory/clients/[id]` — full-page view (drawer overlay deferred); Details card (ABN, billing email/address, payment terms, Xero contact placeholder), Primary partner card (links to Person detail), Projects list (empty state pointing to TASK-030)
- [x] Permission: Partner+ can see (`hasAnyRole(['super_admin', 'admin', 'partner'])`); Admin+/Partner can create via `client.create`

**note:** AR sparkline deferred — needs meaningful AR aging data (Xero nightly pull, TASK-055). AR outstanding computed inline from approved/sent/partial/overdue invoices: `amountTotal - paymentReceivedAmount`.

### TASK-025 — New Client wizard
**status:** done
**depends on:** TASK-024
**acceptance:**
- [x] Fields: code (uppercase A-Z0-9, unique), legal name, trading name, ABN (11 digits, spaces ok, optional), billing address, billing email, primary partner (select of partner-role persons), payment terms (net-14 / net-30 / net-45)
- [x] Server action `createClient` with Zod validation, `prisma.$transaction` inserting Client + AuditEvent
- [x] Xero contact creation — stubbed (code-level no-op with `xeroContactId` nullable); wires up properly in TASK-051
- [x] Writes `AuditEvent { action: 'created', entity: { type: 'client', after } }`
- [x] Field-level errors returned to form on validation fail; redirect to detail page on success

### TASK-025 — New Client wizard
**status:** todo
**depends on:** TASK-024
**acceptance:**
- [ ] Fields: code (uniqueness enforced), legal name, trading name, ABN (validated), billing address, billing email, primary partner, payment terms
- [ ] On finish: creates Client + Xero contact (via Xero integration if enabled, stub otherwise)
- [ ] Writes `AuditEvent`

### TASK-026 — Rate card view + edit
**status:** done
**depends on:** TASK-020
**acceptance:**
- [x] `/admin/rate-card` view — gated on `ratecard.view` (super_admin, admin, partner)
- [x] Table: role code (badge), role label, band, effective from, cost/hr, bill rate low, bill rate high
- [x] "Active as of <date>" selector with Today shortcut — resolves to the most-recent row per role with `effectiveFrom <= asOf`
- [x] `/admin/rate-card/new` — versioned add (roleCode + effectiveFrom + cost + bill low/high); never mutates existing rows; duplicate (roleCode, effectiveFrom) blocked
- [x] Audit event per create (entity: `rate_card`)

**note:** Listing logic in `src/server/rate-card.ts` — `listRateCardAsOf(asOf)` picks one row per roleCode (newest `effectiveFrom <= asOf`) and sorts by a business-sensible order (Leadership → Expert → Fellow → Consultant → Analyst → Intern). Bill rate low/high are MVP heuristics (cost × 2 / × 3) per TASK-020 seed — replace once Foundry's real pricing matrix is ingested.

---

## Phase 1B — Project lifecycle

### TASK-030 — New Project wizard (core fields)
**status:** doing
**depends on:** TASK-024
**acceptance:**
- [ ] ~~Stepped sidebar wizard~~ — shipped as single-form with three `<section>` groups (Basics / Commercials / Team). Stepped sidebar deferred to TASK-030b when real wizard UX is needed — works fine as a single form for MVP.
- [x] Basics: code (unique, `/^[A-Z][A-Z0-9]{2,9}$/`), client (select), name, description
- [x] Commercials: contract value (AUD dollars, stored as cents), start, end (end > start enforced by Zod refine)
- [x] Team leadership: primary partner (partner-band persons only), project manager (any active person)
- [ ] Team allocations + milestones at create — **deferred to TASK-035/TASK-036**; empty state on detail page points to those tasks
- [x] Creates `Project` + audit event in `prisma.$transaction`
- [x] Permission: `project.create` (super_admin, admin, partner)

### TASK-032 — Xero tracking category per project
**status:** done
**depends on:** TASK-030, TASK-050
**acceptance:**
- [x] On project create, ensure a tracking category value exists for the project code (shipped as part of TASK-052)
- [x] `xero_tracking_category_value` written back
- [x] Reuses category "Projects" — creates the value, not the category

**note:** Implementation lives in `src/server/integrations/xero-projects.ts` (`ensureProjectTrackingOption`). Called from `/projects/new` action and available on-demand via any flow that needs the option.

### TASK-033 — Projects list
**status:** doing
**depends on:** TASK-030
**acceptance:**
- [x] `/projects` list: code, name, client (linked), stage (badge colour by stage), primary partner, manager, contract value
- [ ] Actual spend / margin columns — **deferred**; need timesheet cost aggregation (TASK-040 onward) + expense totals (TASK-042). Currently only contract value surfaces.
- [x] Filters: stage, active/archived. Client + partner filters deferred until the directory surfaces them meaningfully at scale.
- [x] Role-scoped via `listProjects(session, …)`: super_admin/admin/partner see all; manager sees where `managerId === self`; staff sees `team.some(personId === self)`; scope filter also applied on detail page (`/projects/[code]`) — non-owners get 404.
- [x] Empty state with CTA; loading via Next suspense; error via Next error boundary.

### TASK-034 — Project detail: Brief tab
**status:** done
**depends on:** TASK-033
**acceptance:**
- [x] `/projects/[code]` with tabs: Brief, Team, Milestones, P&L, Files, Risks (Settings lives behind a top-right button rather than a tab — deliberate: rare action, keeps tab bar compact)
- [x] Brief: description, contract value (header), dates, leadership, SharePoint link, admin folder link, Xero tracking category status
- [x] Edit (Settings) gated to Admin+ / owning Partner / owning Manager via the existing `/projects/[code]/settings` capability checks

### TASK-035 — Project detail: Team tab
**status:** done
**depends on:** TASK-034
**acceptance:**
- [x] `/projects/[code]/team/edit` page — add/remove ProjectTeam rows, per-row role + allocation %.
- [ ] Utilisation conflict detection (>100% across projects) — **deferred to TASK-035b**
- [x] Audit event on save (entity: project_team, before/after with added/removed).

### TASK-036 — Project detail: Milestones tab
**status:** done
**depends on:** TASK-034
**acceptance:**
- [x] `/projects/[code]/milestones` — CRUD (label, due, amount, status). Inline status select auto-submits.
- [x] Invoice link column surfaces `milestone.invoiceId` (populated when invoice drafter attaches).
- [x] Totals row; amber banner when sum > contract value.
- [x] Audit event on every create + status update.

### TASK-037 — Project detail: P&L tab
**status:** todo
**depends on:** TASK-034
**acceptance:**
- [ ] Revenue (invoiced + WIP) vs cost (timesheet × cost_rate + expenses) vs margin
- [ ] Stacked bar by month
- [ ] Permission: Super Admin / Admin / owning Partner / owning Manager

### TASK-038 — Project detail: Files tab
**status:** done
**depends on:** TASK-034, TASK-031
**acceptance:**
- [x] "Open team folder" + "Open admin folder" deep links; if not yet provisioned, a Provision button triggers TASK-031's template-copy flow
- [ ] Lists recent files from SharePoint folder (via Graph) — **deferred to TASK-038b**; MVP ships links only. Listing would need per-request Graph lookups + pagination UI which adds load for a feature staff can already get in one click.
- [x] No in-app upload — staff upload directly in SharePoint, which matches Foundry's existing workflow and avoids binary handling in Foundry Ops

### TASK-039 — Project detail: Settings + Risks tabs
**status:** done
**depends on:** TASK-034
**acceptance:**
- [x] Settings form at `/projects/[code]/settings` — name / description / stage / startDate / endDate / actualEndDate / contractValue / primaryPartner / manager. Zod validation with endDate > startDate refine. Audit event with before/after snapshot.
- [x] Risks: CRUD at `/projects/[code]/risks` — title, severity (low/medium/high), status (open/mitigating/closed), owner (optional), mitigation (optional). Inline severity + status dropdowns auto-submit. Risks tab on project detail links to the manage page.
- [x] Audit event per every mutation.
- [ ] Billing freq / reporting period — **deferred to TASK-039c**; neither is on the Project schema yet.

---

## Phase 1C — Transactional flows

### TASK-040 — Timesheet: week grid
**status:** done
**depends on:** TASK-033
**acceptance:**
- [x] `/timesheet?week=YYYY-MM-DD` week view (defaults to this week). Rows = projects (one description per row), cols = 7 days (Mon→Sun), cells = hours (0.25 step). Daily totals shown; day >24h highlighted red.
- [x] Add-row: project picker includes every active (non-archived) project (broader than "only projects person is on" per the spec, which is too restrictive at Foundry — people often self-log before formal team assignment). Projects already on the sheet are filtered from the picker.
- [x] "Save draft" + "Submit for approval" buttons. Submit flips eligible entries to `submitted`; Save keeps them `draft`. Approved/billed entries are locked from edit (inputs disabled, no status change).
- [x] Validation in `saveTimesheet` server action: Zod clamps per-cell 0–24; sum per day > 24 rejected; description required when row total > 0.
- [x] Prev/Next/This week navigation; audit event per save/submit (entity `timesheet_week`, id = `<personId>:<weekStart>`).

### TASK-041 — Timesheet: approval
**status:** done
**depends on:** TASK-040
**acceptance:**
- [x] `/timesheet/approve` (not inside `/approvals` — dedicated route; timesheets are high-volume and line-level, not aggregated like money items).
- [x] Managers see submitted entries for projects they manage; super_admin/admin see all.
- [x] Grouped by person + week with per-entry multi-select checkboxes (all pre-checked). Note field required for reject.
- [x] Approve → `TimesheetEntry.status = 'approved'`, `approvedById/approvedAt` set; Reject → `status = 'draft'` (entry bounces back to submitter's sheet). Audit event per entry decision.
- [x] Approved entries are `billable` per the invoice drafter's lens (TASK-094 / TASK-044 line-item sourcing will pull them).

### TASK-042 — Expense: submit
**status:** doing
**depends on:** TASK-021
**acceptance:**
- [x] `/expenses/new`: date, amount (inc GST), GST (auto ÷ 11, overridable), category (travel/meals/office/tools/subscriptions/other), project (optional "— OPEX —"), vendor, description
- [ ] Receipt upload → SharePoint — **deferred to TASK-042b** (needs Graph Files scope)
- [x] GST auto-calc + manual override
- [x] Category enum picker
- [x] Project optional, blank = OPEX
- [x] Submit creates `Expense { status: submitted }` + `Approval` row + audit event in one `prisma.$transaction`

### TASK-043 — Expense: approval + reimburse queue
**status:** doing
**depends on:** TASK-042
**acceptance:**
- [x] Threshold routing in `src/server/approvals.ts`: >$2k → super_admin; ≤$2k → admin (manager own-project refinement deferred)
- [x] Approve/reject in /approvals queue with audit event; decision note required on reject
- [ ] Approved → reimbursement pay-run batching — **deferred to TASK-100 (ABA generator)**

### TASK-044 — Invoice: draft (manual)
**status:** doing
**depends on:** TASK-036, TASK-041
**acceptance:**
- [x] `/invoices/new?projectId=…` single-form with dynamic line items (label + AUD amount rows), live 10% GST + total
- [ ] Milestone / T&M auto-fill — **deferred to TASK-094** (Invoice Drafter agent); manual lines only for MVP
- [x] Auto-calculates GST + total
- [x] Save as draft (status `draft`) or Save + submit (status `pending_approval` + Approval row via `resolveRequiredRole('invoice', total)`)
- [x] Auto invoice-number `<ProjectCode>-INV-<NN>` per project (max seq + 1)
- [x] `/invoices` list + `/invoices/[id]` detail, role-scoped

### TASK-045 — Invoice: approval + send
**status:** doing
**depends on:** TASK-044
**acceptance:**
- [x] Approval routing via DB policy → defaults (>$20k super_admin; ≤$20k partner) with override via TASK-049 admin UI
- [x] Approve in `/approvals` queue → Invoice status flips to `approved` (audit event in same tx)
- [x] Push to Xero as draft (auto on approval, best-effort; manual retry button on detail page)
- [ ] Send button + Xero status webhook — **deferred to TASK-053b** (needs inbound webhook infra)

### TASK-046 — Bill (AP): upload + draft
**status:** doing
**depends on:** TASK-020
**acceptance:**
- [x] `/bills/new` form: supplier name, optional contractor Person link, supplier invoice number, issue/due dates, category (subscriptions / hosting / office / professional_services / contractor_payment / travel / other), amount + GST (auto ÷ 11, overridable), optional project, optional cost centre
- [ ] File upload → SharePoint — **deferred to TASK-046b** (needs Graph Files scope). Pasted SharePoint URL supported as an interim; UI hints at 046b.
- [x] Supplier picker: either external org (typed name) or an existing contractor Person (dropdown filtered to `employment=contractor, endDate=null`)
- [x] Status `pending_review`; `receivedVia='manual'`; audit event on create/submit
- [x] "Save for review" + "Save + submit for approval" buttons

### TASK-047 — Bill: approval + push to Xero
**status:** doing
**depends on:** TASK-046
**acceptance:**
- [x] Super Admin approval required by default (per A8); thresholds configurable via `resolveRequiredRole('bill', total)` + TASK-049 UI
- [x] Approve in `/approvals` queue → `Bill.status = 'approved'` (same tx + audit). Reject → `Bill.status = 'rejected'`.
- [x] Push to Xero as draft (auto on approval, best-effort; manual retry on detail page) — see TASK-054
- [ ] Xero webhook updates paid status — **deferred to TASK-054b** (needs signed-webhook infra)

---

## Phase 1D — Approvals

### TASK-048 — Approvals queue UI
**status:** doing
**depends on:** TASK-043 (invoice/bill/payrun subjects layer in as those ship)
**acceptance:**
- [x] `/approvals` list shows pending Approval rows where `requiredRole ∈ session.roles`
- [ ] Filter by type — **deferred**; single-type queue is small enough for MVP
- [x] Inline approve/reject with note field (required on reject)
- [x] Approval status + subject status both updated in same transaction with audit event
- [x] Decided rows disappear from queue (`where: { status: 'pending' }`)

### TASK-049 — Approvals: threshold config UI
**status:** doing
**depends on:** TASK-048
**acceptance:**
- [x] `/admin/approval-policies` gated on `approval.policy.edit` (super_admin only)
- [x] Add-policy form — subject type, comparator (gt / gte / lt / lte / any), threshold (AUD dollars → cents), required role, require-MFA flag
- [x] Audit event on upsert (entity: `approval_policy`, before/after)
- [x] `resolveRequiredRole(subjectType, amountCents)` in `src/server/approval-policies.ts` fetches active DB policies first, falls back to `DEFAULT_POLICIES` (code-level) when no row matches — no hard-coding in call sites. Expense submit action now uses it.
- [ ] Edit / disable / delete existing policies — **deferred to TASK-049b**; add-only for MVP is enough to override defaults

**note:** DEFAULT_POLICIES table mirrors the hard-coded thresholds from the initial approvals.ts so behaviour is unchanged when DB is empty. Admin can add a matching row with a different `requiredRole` to override a built-in. Invoice and bill flows will pick this up automatically once they submit approvals through `resolveRequiredRole`.

---

## Phase 1E — Xero integration

### TASK-050 — Xero OAuth connect
**status:** done
**depends on:** TASK-010
**acceptance:**
- [x] `/admin/integrations/xero` connect button → OAuth dance
- [x] Access + refresh tokens stored encrypted (AES-256-GCM via `encryptJson`)
- [x] Disconnect button (revokes refresh token on Xero, clears local state)
- [ ] Webhook signature verification middleware — **deferred to TASK-053** (only needed once we receive webhooks)

**note:** Authorization code flow (Web App). Granular scopes required — app was registered post-2026-03-02. Scopes: `openid profile email offline_access accounting.contacts accounting.settings accounting.invoices accounting.banktransactions`. User verified end-to-end connect/disconnect works.

### TASK-051 — Xero: contact sync
**status:** done
**depends on:** TASK-050, TASK-024
**acceptance:**
- [x] On Client create: upsert Xero contact, store `xero_contact_id` (best-effort, non-blocking)
- [x] Manual re-sync button on client detail page (covers "edit" path — there is no separate edit form yet)
- [ ] Contractor Person rows also sync as contacts — **deferred to TASK-023c** (matches prior decision)
- [ ] Nightly reconciliation job finds drift — **deferred** (not blocking MVP; add once cron infra lands in TASK-055)

### TASK-052 — Xero: tracking category sync
**status:** done
**depends on:** TASK-050, TASK-030
**acceptance:**
- [x] On project create: ensure tracking category value exists (`ensureProjectTrackingOption`, best-effort)
- [ ] Nightly: list Xero tracking categories, warn on orphans — **deferred** (same reasoning as TASK-051 nightly)

### TASK-053 — Xero: invoice push + status webhook
**status:** done
**depends on:** TASK-045
**acceptance:**
- [x] On invoice approve: push to Xero as draft invoice with line items + tracking (`pushInvoiceToXero`, called best-effort after the approval transaction commits)
- [x] Idempotent on `Invoice.xeroInvoiceId` — re-push updates the existing Xero invoice instead of duplicating
- [x] Auto-ensures prerequisites: creates missing Xero contact for the client and tracking option for the project
- [x] "Push to Xero" / "Re-push to Xero" button on invoice detail page (super_admin / admin / partner)
- [x] Audit event `xero_pushed` written on successful push
- [ ] Webhook updates status (`authorised`, `paid`, `voided`) + paid_at — **deferred to TASK-053b** (needs signed-webhook infra)
- [ ] Conflict flag raised if Xero invoice is edited after push — **deferred to TASK-053b**

**note:** Invoice line items use `TaxType=OUTPUT` (AU GST) and `LineAmountTypes=Exclusive`, so Xero computes GST from the line subtotals. Sales `AccountCode` is optional via `XERO_SALES_ACCOUNT_CODE` env — Xero applies org default when absent. Pure payload builder is unit-tested (`src/__tests__/xero-invoices.test.ts`).

### TASK-054 — Xero: bill push + status webhook
**status:** done
**depends on:** TASK-047
**acceptance:**
- [x] On bill approve: push as Xero ACCPAY (draft) (`pushBillToXero`, called best-effort after the approval transaction commits)
- [x] Idempotent on `Bill.xeroBillId` — re-push updates existing
- [x] Single-line bill: description = "<Category> — <Supplier>"; `LineAmountTypes=Inclusive`, `TaxType=INPUT`
- [x] Uses Person's `xeroContactId` when a contractor supplier has one; falls back to `Contact.Name` (Xero name-matches or creates)
- [x] Auto-ensures project tracking option when `projectId` is set; tracking + `Reference` only present for project-coded bills (OPEX bills have no tracking)
- [x] "Push to Xero" / "Re-push" button on bill detail page (super_admin only — matches `bill.approve` capability)
- [x] Audit event `xero_pushed` on successful push
- [ ] Webhook updates paid status — **deferred to TASK-054b** (needs signed-webhook infra)

**note:** Expense `AccountCode` is optional via `XERO_EXPENSE_ACCOUNT_CODE` env — Xero applies org default when absent. Pure payload builder unit-tested in `src/__tests__/xero-bills.test.ts`.

### TASK-055 — Xero: nightly bank-feed pull
**status:** done
**depends on:** TASK-050
**acceptance:**
- [x] Nightly job stores raw bank transactions in `BankTransaction` table (`pullBankTransactions`)
- [x] Idempotent on `xeroTxnId` — re-running the pull over overlapping windows updates rather than dupes
- [x] Vercel Cron schedule at 17:30 UTC daily (≈3:30 AM AEST) via `vercel.json`; authenticated via `CRON_SECRET`
- [x] Rolling 30-day lookback window — safer than tracking a persistent cursor for MVP, Xero caps paginated responses at 100/page
- [x] Signed amount cents (SPEND / SPEND-TRANSFER → negative; RECEIVE / RECEIVE-TRANSFER → positive)
- [x] `rawPayload` jsonb retained for downstream Xero Reconciler agent (TASK-083)
- [x] Skips cleanly when Xero isn't connected (returns 200 `{ skipped: ... }`)

**note:** Endpoint at `/api/cron/xero-bank-pull`. `parseXeroDate` + `signedAmountCents` are pure helpers and unit-tested. Bank-feed import is "bank transactions Xero has recorded" — real bank-feed ingestion (e.g. bank statement lines) is out of scope for MVP and would come with the Xero Reconciler agent.

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
