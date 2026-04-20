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
**status:** doing
**depends on:** TASK-020
**acceptance:**
- [x] `/admin/rate-card` view — gated on `ratecard.view` (super_admin, admin, partner)
- [x] Table: role code (badge), role label, band, effective from, cost/hr, bill rate low, bill rate high
- [x] "Active as of <date>" selector with Today shortcut — resolves to the most-recent row per role with `effectiveFrom <= asOf`
- [ ] Edit creates a new versioned row — **deferred to TASK-026b** (needs a form + action similar to Person edit, plus a "compare to previous version" preview)
- [ ] Audit event on every change — will land with 026b

**note:** Listing logic in `src/server/rate-card.ts` — `listRateCardAsOf(asOf)` picks one row per roleCode (newest `effectiveFrom <= asOf`) and sorts by a business-sensible order (Leadership → Expert → Fellow → Consultant → Analyst → Intern). Bill rate low/high are MVP heuristics (cost × 2 / × 3) per TASK-020 seed — replace once Foundry's real pricing matrix is ingested.

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
