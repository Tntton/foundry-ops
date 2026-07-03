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
- [x] Email aliases kept at existing local parts (`bills@`, `receipts@`, `accounts@`) — domain only swapped. **RESOLVED 2026-05-29 (TT):** `finance@foundry.health` is the canonical accounts mailbox (end-state); `trung@foundry.health` is polled as a transitional source while vendors migrate. `bills@`, `receipts@`, `accounts@` no longer planned as separate intake mailboxes — `accounts@` retained only as an outbound display alias; receipt intake stays on the Uber email-intake (TASK-040d) + WhatsApp (TASK-079) channels. INTEGRATIONS.md §1 + AGENTS.md §2 updated to match. See TASK-093 for the AP-intake build.
- [x] `grep -r "foundryhealth.com.au" --exclude=TASKS.md` returns zero matches (TASK-000 self-references the old domain in its description, which is expected)
- [x] Commit: `chore(TASK-000): correct domain foundryhealth.com.au → foundry.health`

**context:** Confirmed by user 2026-04-19 — Foundry does not own `foundryhealth.com.au`; the real domain is `foundry.health`. All Entra tenant restrictions, auth allowlists, email routing, SharePoint URLs, and webhook hosts must use `foundry.health`.

**note on completion:** 9 files updated; screens-auth.jsx line 49 collapsed the dual-domain check to a single `@foundry.health` check. Mailbox canonicalisation resolved 2026-05-29 (TT) — see acceptance line above: `finance@` canonical, `trung@` transitional, `bills@/receipts@/accounts@` retired as intake mailboxes. TASK-093 now drives the AP-intake build against those two mailboxes via Graph polling.

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
**status:** done
**depends on:** TASK-034
**acceptance:**
- [x] Revenue (invoiced + WIP) vs cost (timesheet × cost_rate + expenses + project-coded bills) vs margin, ex GST throughout
- [x] Monthly breakdown table with inline horizontal bars (revenue green / cost red); stacked bar chart deferred as horizontal twin-bar reads as well for a 12-month window and doesn't need a charting lib
- [x] Permission: Super Admin / Admin / owning Partner / owning Manager; anyone else sees a visibility notice
- [x] Empty state when no activity yet, with guidance on what to log/approve to populate

**note:** Uses current `Person.rate` as the cost rate (not rate-card-as-of-date lookups) — simpler, accurate enough for MVP P&L. Historical-rate rigour lands when rate-card versioning is live. Computation lives in `src/server/projects/pnl.ts` (`computeProjectPnL`).

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

### TASK-093 — Agent: AP intake (invoice-autoharvest from M365 mailboxes)
**status:** doing
**depends on:** TASK-046 (manual Bill flow + Bill model fields), TASK-040c (intake-ocr extractor — already in tree)

**note on scope expansion (2026-05-29, TT):** Originally a one-line spec ("Graph subscription on `bills@`"). Replaced with the full enriched build below. TASK-082 (agent framework) is **not** a dependency — this agent runs as a Vercel cron (mirrors the Uber email-intake pattern at TASK-040d), not as an Inngest workflow. If/when the workflow framework lands, the per-message processing loop is portable.

**Architecture (locked):**
- Source: Microsoft Graph `/users/{upn}/messages` polled directly (app-token, `Mail.Read` scoped via `New-ApplicationAccessPolicy` to `finance@` + `trung@` only — least-privilege per A6, NOT tenant-wide).
- Cursor: new `MailboxPollCursor` Prisma model — `{ mailboxUpn (unique), lastReceivedDateTime, enabled, lastPollAt, lastError, createdAt, updatedAt }`.
- Cron: `/api/cron/invoice-autoharvest` at `*/15 * * * *` (Vercel Pro is already used by the Uber cron at TASK-040d).
- Actor: pinned to first `super_admin` (= TT), mirroring the Uber cron precedent.
- Output: `Bill { status: pending_review, receivedVia: 'email', originalEmailId, supplierId|null, supplierName, supplierInvoiceNumber, amountTotal, gst, issueDate, dueDate, category, attachmentSharepointUrl? }` + `Approval` row + `AuditEvent` in one `prisma.$transaction`. Note: low-confidence does **not** flip to `awaiting_human` (no such enum value on `BillStatus`); confidence surfaces in the audit-event delta + admin "needs-attention" counter instead.

**acceptance:**
- [ ] New Prisma model `MailboxPollCursor` + migration. Seed: rows for `finance@foundry.health` (enabled: true) and `trung@foundry.health` (enabled: true, transitional — comment in seed.ts notes this can be flipped off once vendors migrate). TT to confirm migration shape before `prisma migrate dev`.
- [ ] `Mail.Read` (Application) granted on the existing Entra app registration + admin-consented in the `foundry.health` tenant; `New-ApplicationAccessPolicy` restricts the app to `finance@` + `trung@` (Exchange Online PowerShell steps documented in `INTEGRATIONS.md §1`). TT to run + confirm before the cron code lands.
- [ ] `src/server/integrations/m365-mail-intake.ts`:
  - `looksLikeInvoice(message)` — sender domain ≠ `@foundry.health` (allowing forwards from internal staff but downstream extraction reads the embedded original); ≥1 attachment with mimeType `application/pdf` or `image/*`; subject matches `/invoice|bill|statement|receipt|payable|due|payment/i`; M365 personal categories (`personal`, `private`) skipped.
  - `pollMailbox(upn, since)` — Graph `GET /users/{upn}/messages?$filter=receivedDateTime gt {cursor}&$expand=attachments($select=id,name,contentType)&$top=50&$orderby=receivedDateTime asc`, paged via `@odata.nextLink`.
  - `processMessage(msg)` — for each candidate attachment download via `/users/{upn}/messages/{mid}/attachments/{aid}/$value` (or contentBytes on `fileAttachment`); run `extractIntakeFields` (existing intake-ocr helper); pick highest `confidence.overall` across attachments; match supplier by ABN then by name (Supplier table); dedupe by `(supplierName || supplierId) + supplierInvoiceNumber`; create Bill+Approval+Audit in one tx.
  - `getMailIntakeStats()` — admin-page data: per-mailbox `{ enabled, lastPollAt, lastError, billsCreated24h, candidatesScanned24h, lowConfidenceCount24h, failedExtracts24h, recentFailures: [{ subject, from, messageId, reason }] }`.
- [ ] `/api/cron/invoice-autoharvest/route.ts` — `CRON_SECRET` gate, loop enabled cursors, write heartbeat AuditEvent per mailbox (so health derives from cron success), `maxDuration: 180`, returns JSON summary.
- [ ] `vercel.json` — add `*/15 * * * *` cron entry.
- [ ] `src/app/admin/integrations/mail-intake/page.tsx` — per-mailbox card (last poll, 24h counters, recent-failures table, enable/disable toggle bound to `MailboxPollCursor.enabled`). Server action writes audit on toggle.
- [ ] `src/server/system-health.ts` — new "Mail intake" component: `up` when both enabled mailboxes have polled successfully in last 60min; `degraded` when one is stale or last poll set `lastError`; `down` when both fail; `not_configured` when no cursor rows or `Mail.Read` not granted.
- [ ] Tests:
  - Golden-file test for `looksLikeInvoice` (fixtures: invoice from Xero supplier; forwarded `Re: Fwd:` invoice; calendar invite; personal mail from gmail; multi-attachment with logo + invoice PDF; follow-up reminder).
  - Mocked Graph response → poller test: cursor advances; only candidates pass to OCR (mocked); Bills created with correct fields; dedupe blocks repeat; per-message errors don't halt the loop; audit events written.
- [ ] `INTEGRATIONS.md §1` updated (Mail.Read line) + new `§7 Mail intake (AP autoharvest)` mirroring §6 Uber structure.
- [ ] `AGENTS.md §2` updated (trigger line: cron polling of finance@ + trung@ via Graph, not webhook on bills@).
- [ ] Smoke test: TT triggers the cron from Vercel UI on prod, watches a real invoice land as a Bill row queued for approval. Smoke pass is the gate to mark this task `done`.

**Do NOT (per CLAUDE.md):**
- Auto-pay / auto-send anything — Bills land in the approval queue (A7).
- Process emails older than the cursor watermark.
- Skip Zod validation on the LLM output (`extractIntakeFields` already does retry × 3 + schema-validate).
- Read mail outside the two scoped mailboxes (ApplicationAccessPolicy enforces this server-side).

**Edge cases (named in spec, must be covered):**
- Forwarded emails (`Re: Fwd:`) — heuristic accepts; OCR reads the embedded attachment regardless of forwarder.
- Multiple attachments — try each, take highest-confidence Bill candidate.
- Same vendor sending follow-up reminders — dedup by `invoiceNumber + supplierName`, not message ID.
- Internal forwards from staff — sender domain check is the staff member's address; allowed (so admin can forward into finance@), but the OCR runs on the attachment content, not the forwarder's signature.
- M365 personal categories present → skip without OCR.

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

### TASK-123 — WhatsApp: surface delivery status
**status:** todo
**depends on:** TASK-120
**context:** Meta posts `statuses` events (`sent → delivered → read → failed`) to the webhook. Today [whatsapp/webhook/route.ts](src/app/api/whatsapp/webhook/route.ts) parses them out of the payload type but drops them on the floor (see the comment at the `statuses` branch) — so a message Meta accepts but never delivers (e.g. recipient not on the test-recipient list, or error `131047` outside the 24h window / missing template) is invisible in-app. This is exactly the confusion hit during first setup (2026-07-01): "✓ Sent" with a real `wamid` but nothing landed.
**acceptance:**
- [ ] Webhook handles `value.statuses[]`: persist latest status + `errors[]` (code + title) against the outbound message row (keyed by `wamid`)
- [ ] Failed/undelivered surfaced somewhere an Admin can see (integration screen or the send-test panel), including Meta's error code + human title
- [ ] Signature verification unchanged; still returns 200 to avoid Meta retry storms
- [ ] Test: golden webhook payload with a `failed` status → row updated + error captured
- [ ] Commit: `feat(TASK-123): surface WhatsApp delivery status + failures`

### TASK-124 — chore: unify Graph API version
**status:** todo
**depends on:** TASK-120
**context:** [whatsapp.ts](src/server/integrations/whatsapp.ts) pins `GRAPH_BASE` at `v21.0` while the register action in [whatsapp/actions.ts](src/app/(app)/admin/integrations/whatsapp/actions.ts) calls `v22.0`. Both work today; drift is a latent footgun when one version deprecates.
**acceptance:**
- [ ] Single source of truth for the Graph API version (one const, imported by both call sites)
- [ ] Typecheck + lint green
- [ ] Commit: `chore(TASK-124): unify WhatsApp Graph API version`

### TASK-125 — public privacy policy page (Meta app publish prerequisite)
**status:** done
**depends on:** —
**context:** Meta requires a publicly crawlable Privacy Policy URL before a WhatsApp app can be flipped to Live/published mode (needed for real inbound messages to reach the webhook). `foundry.health` has no privacy page. Added a public route on the ops app.
**acceptance:**
- [x] Public `/privacy` route at [src/app/privacy/page.tsx](src/app/privacy/page.tsx) — placed outside the `(app)` route group so it's reachable without a session (same pattern as `/healthz`; auth is enforced in `(app)/layout.tsx`).
- [x] Honest, accurate content: internal-tool scope, WhatsApp message/media processing, processors (Meta/Microsoft/Xero/Anthropic), APP/Privacy Act 1988 reference, contact.
- [x] Typecheck + lint green.
- [ ] **Follow-up (TT):** have wording reviewed before treating as final legal text (contact address set to `contact@foundry.health`). Set the Meta App → Settings → Basic Privacy Policy URL to `https://ops.foundry.health/privacy` and publish.
- [ ] Commit: `feat(TASK-125): public privacy policy page for Meta app publish`

### TASK-126 — leader dashboard: group actions into columns + per-group hide/snooze
**status:** done
**depends on:** —
**note (2026-07-02):** Built. 5 columns from `kind`, per-group Hide + Snooze 7/14/30d inline menu, "Show" chips for suppressed groups, headline counts visible-only. Prefs in `UserPreference.prefs.dashboardActionGroups` (no migration). Pure helpers in `src/server/dashboard-prefs.ts` (18 unit tests), session-checked + audited server action. Typecheck + 295 tests + lint green. NOT runtime-verified — needs a leader login against a live DB (couldn't reach prod from here).
**context:** TT (2026-07-02): the leader dashboard "actions to clear" strip is a flat, ungrouped list and feels like a mess. Group actions L→R into columns by category, and let a leader hide or snooze whole groups they don't need to action (e.g. all `deal_stale`), managed inline on the dashboard. Decisions (TT): **both** permanent-hide and timed-snooze per group; controls **inline** on the dashboard.
**design:**
- 5 groups from the existing `LeaderPendingAction['kind']`: Approvals (bill/expense/invoice/timesheet queues) · Delivery (project_stale, project_missing_milestones) · Business Dev (deal_stale) · Billing (invoice_to_draft) · Personal (self_*).
- Persist per-person state in `UserPreference.prefs.dashboardActionGroups` (no migration — reuse existing model). Each group: `{mode:'hidden'}` or `{mode:'snoozed', until: ISO}`; absent = visible. Expired snooze → visible.
- Pure helpers (group mapping, suppression, merge) unit-tested; thin prisma read/write; server action session-checked + audited (A9).
**acceptance:**
- [ ] `src/server/dashboard-prefs.ts` — group defs, total kind→group map, pure `isGroupSuppressed` / `groupActions` / `applyGroupOp`, `get/setDashboardActionGroupPref`.
- [ ] Server action updates only the caller's own prefs, Zod-validated, writes AuditEvent, `revalidatePath('/')`.
- [ ] `LeaderActionStrip` renders responsive columns; each header has inline Hide + Snooze (7/14/30d); suppressed groups shown as a slim "Show" chip row.
- [ ] Dashboard "N to clear" count reflects visible (non-suppressed) actions.
- [ ] Unit test for the pure helpers (mapping totality, snooze expiry, merge/clear).
- [ ] Typecheck + lint + tests green. (No migration; runtime verification needs a live DB + leader login — flag in commit.)
- [ ] Commit: `feat(TASK-126): leader dashboard action groups + hide/snooze`

### TASK-127 — WhatsApp prefill links: 24h TTL
**status:** done
**depends on:** —
**note (2026-07-02):** WhatsApp-issued prefill deep-links were expiring at the 15-min web default. Added `WHATSAPP_PREFILL_TTL_SECONDS` (24h) in [prefill/token.ts](src/server/agents/assistant/prefill/token.ts) and applied it to the timesheet + expense links minted in [whatsapp-router.ts](src/server/integrations/whatsapp-router.ts). Web prefill (same-session) stays 15 min. Test added (valid-at-23h / expired-past-24h). Typecheck + tests + lint green. Commit `feat(TASK-127)` `7189b5a`.

### TASK-128 — WhatsApp prefill: completion reminders
**status:** done (reminders); reply-to-confirm split to TASK-129
**depends on:** TASK-127, TASK-302c
**note (2026-07-02):** Built the reminder half. Reply-to-confirm deferred to [[TASK-129]] (TT chose "reminders only" this pass — it needs a headless financial-write path best done with DB verification). New `WhatsAppPrefillDispatch` model + hand-authored migration (`20260702000000_whatsapp_prefill_dispatch`); dispatch row created on both WhatsApp prefill sends (jti persisted from `signPrefillToken`); pure `dueReminder` (early + last-call, last-call-priority) unit-tested; cron `/api/cron/whatsapp-prefill-reminders` (hourly in vercel.json) sends the nudge, re-sends the link + in-app-browser tip, and marks completion when the target record exists. Typecheck + 307 tests + lint green. **Migration + live WhatsApp send NOT verified locally (no DB) — verify on deploy.** Also fixed stale "15-min link" copy → "link valid 24h".
**context:** TT (2026-07-02): people receive a prefill link on WhatsApp but sometimes the first tap lands in an in-app browser they can't sign into, so the entry never gets submitted. Send reminders to nudge completion, and offer a browser-free fallback. **Decisions (TT):** reminders fire **both** a few hours after send *and* a last-call shortly before the 24h expiry; the fallback is **reply-to-confirm** — replying `CONFIRM` submits the prefilled timesheet/expense directly. NB: reply-to-confirm intentionally reverses part of TASK-302c (no-auto-write) for these low-value (< $20k) items — approved by TT; the high-value web-only rule is untouched (timesheet/expense aren't in that gate).
**design:**
- New model `WhatsAppPrefillDispatch` (migration — applies on deploy; can't verify locally): `id, personId, whatsappNumber, kind, payloadJson, jti, weekIso?, sentAt, expiresAt, completedAt?, earlyReminderAt?, lastCallReminderAt?`. `signPrefillToken` grows an optional `jti` param so the router can persist the same id it embeds.
- On send (whatsapp-router timesheet + expense): create a dispatch row alongside the link.
- **Completion detection without web hooks:** cron checks whether the target record now exists (timesheet entry for person/project/date; expense for person/date/amount). If yes → mark `completedAt`, no reminder. Avoids threading the token through the web form submit.
- **Cron** `/api/cron/whatsapp-prefill-reminders` (CRON_SECRET, matches existing `/api/cron/*`): pure `dueReminders(dispatch, now)` → `'early' | 'lastcall' | null`; send free-form reminder (still inside the 24h service window opened by their inbound, so no template needed) repeating the link + "open in Safari/Chrome, or reply CONFIRM"; stamp the reminder timestamp.
- **CONFIRM handler** in whatsapp-router: `confirm` intent with an outstanding dispatch → apply the payload via the same code path the form uses (`prefill/apply-timesheet.ts` + expense equivalent), full validation + audit, mark `completedAt`, reply confirmation. Guard: only the most recent outstanding dispatch; ignore if none.
**acceptance:**
- [ ] Migration + `WhatsAppPrefillDispatch` model; `prisma generate` clean; seed still runs.
- [ ] Dispatch row created on both WhatsApp prefill sends (jti matches the token).
- [ ] Pure `dueReminders` unit-tested (early window, last-call window, already-sent, completed, expired).
- [ ] Cron sends at most one early + one last-call, skips completed/expired, marks timestamps; existence check marks completion.
- [ ] `CONFIRM` applies the prefill via the shared apply path with audit; rejects when no outstanding dispatch; respects capability checks.
- [ ] Reminder copy includes the browser tip + the reply-to-confirm option.
**acceptance (reminders — this task):**
- [x] Migration + `WhatsAppPrefillDispatch` model; `prisma generate` clean. (seed unchanged; not re-run — no local DB)
- [x] Dispatch row created on both WhatsApp prefill sends (jti matches the token).
- [x] Pure `dueReminder` unit-tested (early window, last-call window, already-sent, completed, expired, last-call priority).
- [x] Cron sends at most one early + one last-call, skips completed/expired, marks timestamps; existence check marks completion.
- [x] Reminder copy includes the browser tip.
- [x] Typecheck + tests + lint green. (Migration + live WhatsApp send need deploy verification.)
- [x] Commits: `chore(db): WhatsAppPrefillDispatch` then `feat(TASK-128): WhatsApp prefill completion reminders`.

### TASK-129 — WhatsApp prefill: reply-to-confirm fallback (deferred from TASK-128)
**status:** done (PR — needs live/staging-DB verification)
**depends on:** TASK-128
**note (2026-07-03):** Built. Added a `confirm` intent (classifier + keyword: confirm/submit/leading-yes, guarded so "yes log 3h…" still routes to timesheet). On `confirm`, `handleConfirm` finds the person's latest outstanding dispatch, pulls the signed token out of its `linkUrl` (`extractPrefillTokenFromUrl`), `verifyPrefillToken`s it (person-bound + kind), and applies the decoded payload via `applyTimesheetConfirm` / `applyExpenseConfirm` — creates **submitted** entries (reach the approval queue, same as a web submit), `source='agent'` audit, then `markDispatchCompleted` (idempotent: a 2nd CONFIRM finds nothing outstanding). No schema change (token already carries the payload). Reminder copy now offers "reply CONFIRM". Pure helpers unit-tested (confirm keyword, token extraction); typecheck + 312 tests + lint green. **Writes financial/timesheet data headlessly — NOT runtime-verified; verify on a live/staging DB before relying on it.** Bills are out of scope (WhatsApp bill links from TASK-132 aren't dispatched, so CONFIRM only applies timesheet/expense).
**context:** TT (2026-07-02): for people who can't open the link in a real browser, let them reply `CONFIRM` to submit the prefilled timesheet/expense directly. Deferred from TASK-128 because it writes financial/timesheet data headlessly and is best built with a live/staging DB to verify. Reverses part of TASK-302c (no-auto-write) for low-value (< $20k) items — TT-approved; high-value web-only gate untouched.
**design:**
- Add `confirm` intent to [classify.ts](src/server/agents/intent/classify.ts) (keywords: confirm, yes, submit).
- On `confirm`: `findLatestOutstandingDispatch(personId)` (WhatsAppPrefillDispatch, not completed/expired). If none → reply "nothing to confirm."
- Apply the stored payload via a shared headless write (factor the create+audit from the router's legacy path / the web submit action), full validation + capability checks, `source='agent'`, then `markDispatchCompleted` and reply confirmation.
- Reminder copy gains the "or reply CONFIRM" line once this ships.
**acceptance:**
- [ ] `confirm` intent + keyword tests.
- [ ] Applies latest outstanding dispatch via shared write path with audit; rejects when none; capability-gated.
- [ ] Idempotent: a second CONFIRM after completion is a no-op with a clear reply.
- [ ] Typecheck + tests + lint green; verified against a live/staging DB.
- [ ] Commit: `feat(TASK-129): WhatsApp reply-to-confirm submits prefill`.

### TASK-131 — WhatsApp agent pre-rollout bug audit
**status:** done (code fixes); config verifications are BLOCKERs for team rollout
**depends on:** —
**context:** TT (2026-07-03): audit all WA agent features before wider team deployment. Traced every flow (timesheet / availability / expense-OCR / status / menu / cancel / unknown / registered-person gating / webhook).
**fixed:**
- [x] **Re-delivery dedup** — the type comment claimed `providerId` dedupes but nothing did; the webhook awaits slow OCR before 200, so Meta retries a slow receipt → duplicate prefill links + duplicate audit/availability writes. Added an inbound-providerId dedupe guard in `handleIncomingWhatsAppMessage` + `maxDuration=60` on the webhook so OCR finishes before the function is killed.
- [x] Stale `HELP_TEXT` copy "links last 15 minutes" → "24 hours".
**BLOCKERS to verify before rollout (config, not code):**
- [ ] **`ANTHROPIC_API_KEY` set in prod** — without it, timesheet/availability parsing + expense OCR all fail (keyword-only intent + "use the web app" errors). The single biggest rollout gate.
- [x] **Model IDs valid** — verified 2026-07-03 against the current model catalog: `claude-haiku-4-5` is current/active; `claude-sonnet-4-5` is legacy-but-active (not deprecated, won't 404). Both resolve; match A4. No swap needed. *Optional future enhancement:* modernise `claude-sonnet-4-5` → `claude-sonnet-5` (near-Opus extraction quality) — a real migration (adaptive thinking on by default, new tokenizer, sampling-param rejection), but current calls set none of those params so it'd be low-risk.
- [ ] `WhatsAppPrefillDispatch` migration applied + `DIRECT_URL` set (see [[foundry-migrations-manual]]) — else reminders + dispatch tracking stay off (core flow now survives via the best-effort hotfix).
**follow-up (non-blocking hardening):**
- [ ] Unique index on `WhatsAppMessage.providerId` (inbound) to make dedup fully race-proof against simultaneous retries (currently best-effort findFirst).
- [ ] Consider returning 200 immediately + processing async (Inngest) instead of awaiting OCR inline — removes the timeout-retry pressure entirely.
- [ ] Accepted/minor: keyword-fallback intent ordering (`hours` → timesheet before status) is offline-only + documented in intent-classify.test.ts; availability writes 0-hour weekend rows.
- [ ] Commit: `fix(TASK-131): WhatsApp re-delivery dedup + stale copy`.

### TASK-132 — WhatsApp: classify document type (receipt vs supplier invoice) and route
**status:** todo
**depends on:** TASK-128, TASK-302b (bill prefill)
**context:** TT (2026-07-03): a user should be able to just send an image and have the agent work out the intended action. Intent auto-detection already works (bare image → expense OCR; free-text → classified). The gap: **every image is currently treated as a personal receipt → Expense.** A supplier *invoice* sent for AP gets mislogged as an expense instead of routed to Bills. Add document-type classification so the agent picks the right flow.
**what already exists (reuse, don't rebuild):** `PrefillKind` has `'bill'`; [prefill-bill.ts](src/server/agents/assistant/tools/prefill-bill.ts) builds a `/bills/new?prefill=` link; the intake-OCR extractor already reads supplier-invoice fields (`invoiceNumber`, `supplierAbn`, payment terms). Only the *classification + branch* is missing.
**design:**
- Add `documentType: 'receipt' | 'supplier_invoice' | 'unknown'` to the intake-OCR extraction (schema + prompt). Signals: an invoice number + ABN + payment terms → supplier_invoice; card/EFTPOS receipt with no invoice number → receipt.
- In the WhatsApp image handler, branch on `documentType`:
  - `receipt` → existing expense prefill link (`/expenses/new?prefill=`).
  - `supplier_invoice` → **bill** prefill link (`/bills/new?prefill=`), reusing the bill payload/token (kind `'bill'`). Submission still goes through the normal Bill approval flow on the web (high-value web-only rule intact — nothing auto-approves).
  - `unknown` / low confidence → reply "Is this a receipt you paid, or a supplier bill? Reply *RECEIPT* or *BILL*" and stash the OCR result in `WhatsAppConversation.state` so the follow-up routes without re-OCR.
- Caption override: if the caption contains "bill"/"invoice" or "receipt", honour it over the classifier.
- Dispatch tracking (TASK-128) records the correct `kind` per branch.
**acceptance:**
- [ ] `documentType` added to intake-OCR + unit test on the classifier prompt shape / fixture receipts vs invoices.
- [ ] Image handler routes receipt→expense, supplier_invoice→bill; ambiguous → RECEIPT/BILL clarify with state stashed (no double OCR on the reply).
- [ ] Caption override honoured.
- [ ] Bill path produces a valid `/bills/new?prefill=` deep-link; no auto-write; audit `source='agent'`.
- [ ] Typecheck + tests + lint green; live smoke: send a supplier invoice → get a Bill link; send a receipt → get an Expense link; send an ambiguous doc → get the RECEIPT/BILL prompt.
- [ ] Commit: `feat(TASK-132): WhatsApp document-type routing (receipt vs bill)`.

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
**status:** doing
**depends on:** phases 1–2 done
**acceptance:**
- [x] Global loading / error / not-found handlers under `src/app/(app)/` cover every route
- [x] List-view empty states audited; gaps patched — timesheet (no active projects), rate card (no rows as-of date), dashboard (stale placeholder replaced with real counts + quick actions)
- [ ] Full-surface PR-grade checklist on every page — **deferred** until real testing flushes the last cracks (staff-role views likely have a few more)

### TASK-203 — Runbook
**status:** todo
**depends on:** phase 4 done
**acceptance:**
- [ ] `RUNBOOK.md` in repo: secrets rotation, re-auth integrations, failed-agent replay, webhook replay, backup + restore

### TASK-220 — Mobile-responsive shell + content polish
**status:** doing
**depends on:** TASK-009
**framing:** the platform was built desktop-first and looks broken on a phone — sidebar takes ~240px of a 400px viewport, dashboard cards get truncated mid-letter. The pilot is desktop-first by design, but TT opens the platform on a phone often enough that this matters. Ship the shell first (biggest single fix), follow up with surface-by-surface polish if needed.

**acceptance — shell (this task):**
- [x] Sidebar hidden on `<md` viewports by default. Hamburger button in the topbar (also `<md` only) opens it as a fixed drawer overlay with a backdrop. Click backdrop OR navigate via the nav → auto-close.
- [x] Topbar's breadcrumb hides on `<sm` (cramped) but ⌘K + user menu stay visible. Hamburger button on the left only renders on `<md`.
- [x] Main content padding tightens: `p-3` on mobile, `p-6` on desktop. Side-by-side flex layout still works on desktop; on mobile it's a single column.
- [x] View-as banner reflows on narrow widths (text wraps instead of overflowing).
- [x] Floating widgets (Feedback + Assistant pills) already handle small screens via `max-w-[calc(100vw-2rem)]`; no further changes needed for this task.
- [x] MobileNavProvider context owns the open state; usePathname effect auto-closes the drawer after navigation.
- [x] Typecheck + lint green; commit.

**Follow-ups (deferred — separate tasks if/when needed):**
- Dashboard card grid stacks cleaner on `<sm` (cards currently shrink rather than wrap when very narrow).
- Tables across the app — horizontal scroll or stacked-row layout on mobile.
- Forms — single-column layout on `<md` (currently `md:grid-cols-3` on most field rows).

### TASK-211 — One-off email migration: firstname-only → firstname.lastname
**status:** todo
**depends on:** TASK-021
**acceptance:**
- [x] Fixtures + seed updated: `prisma/fixtures/team.json`, `foundry-team.jsx`, `prisma/seed.ts` `isStaff` array reflect the new convention (3 partners keep `trung@` / `michael@` / `chris@`, everyone else is `firstname.lastname@`, Rachael explicitly `rachael.spooner@`)
- [x] Invoice preview footer hardcode `jas@foundry.health` → `jas.navarro@foundry.health`
- [x] Integration sync comments (navan-sync, uber-sync) reflect the new convention — fallback is now partner-only (`trung.ton@` → `trung@`), not the general rule
- [x] Migration script shipped at [scripts/migrate_emails.ts](scripts/migrate_emails.ts) with `pnpm migrate:emails` (`--dry` flag for preview). Idempotent, single transaction, writes one `bulk_email_migrate` AuditEvent. Collision-safe (refuses to run if a target email is already taken by a different person).
- [ ] Run `pnpm migrate:emails --dry` against staging, eyeball the diff, then run without --dry against prod (with DB backup taken first)
- [ ] M365 / Entra: existing user-principal-names migrated to match (`will@foundry.health` → `will.macdonald@foundry.health`); old addresses kept as aliases until end of FY26 so existing emails in transit still reach the inbox
- [ ] Xero contact emails updated to match (only relevant for contractors that bill Foundry)
- [ ] Resend / WhatsApp / DocuSign — any saved templates that hardcode an `@foundry.health` address audited and patched
- [ ] AuditEvent row written for the bulk rename (one row, `actor=system`, `action=bulk_email_migrate`, `entityType=person`, delta carries the old→new map)

**SQL to run (after a DB backup):**
```sql
-- One-off rename. Three partners keep their first-name-only alias.
UPDATE "Person" SET email = 'will.macdonald@foundry.health'   WHERE email = 'will@foundry.health';
UPDATE "Person" SET email = 'doug.barnaby@foundry.health'     WHERE email = 'doug@foundry.health';
UPDATE "Person" SET email = 'kathleen.weaver@foundry.health'  WHERE email = 'kathleen@foundry.health';
UPDATE "Person" SET email = 'mark.luhovy@foundry.health'      WHERE email = 'mark@foundry.health';
UPDATE "Person" SET email = 'rachael.spooner@foundry.health'  WHERE email = 'rachael@foundry.health';
UPDATE "Person" SET email = 'alejandro.rosales@foundry.health' WHERE email = 'alejandro@foundry.health';
UPDATE "Person" SET email = 'adrian.aurrecoechea@foundry.health' WHERE email = 'adrian@foundry.health';
UPDATE "Person" SET email = 'matt.byers@foundry.health'       WHERE email = 'matt@foundry.health';
UPDATE "Person" SET email = 'abbi.linghanathan@foundry.health' WHERE email = 'abbi@foundry.health';
UPDATE "Person" SET email = 'jas.navarro@foundry.health'      WHERE email = 'jas@foundry.health';
UPDATE "Person" SET email = 'sohyb.basir@foundry.health'      WHERE email = 'sohyb@foundry.health';
UPDATE "Person" SET email = 'simone.sandler@foundry.health'   WHERE email = 'simone@foundry.health';
UPDATE "Person" SET email = 'jackie.rabec@foundry.health'     WHERE email = 'jackie@foundry.health';
UPDATE "Person" SET email = 'garang.dut@foundry.health'       WHERE email = 'garang@foundry.health';
UPDATE "Person" SET email = 'bharat.ramakrishna@foundry.health' WHERE email = 'bharat@foundry.health';
UPDATE "Person" SET email = 'rahul.gandhi@foundry.health'     WHERE email = 'rahul@foundry.health';
UPDATE "Person" SET email = 'sarah.ravindran@foundry.health'  WHERE email = 'sarah@foundry.health';
UPDATE "Person" SET email = 'kevin.mao@foundry.health'        WHERE email = 'kevin@foundry.health';
UPDATE "Person" SET email = 'ingrid.maravilla@foundry.health' WHERE email = 'ingrid@foundry.health';
UPDATE "Person" SET email = 'haram.hwang@foundry.health'      WHERE email = 'haram@foundry.health';
UPDATE "Person" SET email = 'julia.maguire@foundry.health'    WHERE email = 'julia@foundry.health';
UPDATE "Person" SET email = 'akhila.annamreddi@foundry.health' WHERE email = 'akhila@foundry.health';
UPDATE "Person" SET email = 'sanjay.hettige@foundry.health'   WHERE email = 'sanjay@foundry.health';
UPDATE "Person" SET email = 'lucas.hu@foundry.health'         WHERE email = 'lucas@foundry.health';
UPDATE "Person" SET email = 'allen.xiao@foundry.health'       WHERE email = 'allen@foundry.health';
UPDATE "Person" SET email = 'josh.ting@foundry.health'        WHERE email = 'josh@foundry.health';
UPDATE "Person" SET email = 'lucas.tan@foundry.health'        WHERE email = 'lucast@foundry.health';
UPDATE "Person" SET email = 'jacky.chen@foundry.health'       WHERE email = 'jacky@foundry.health';
UPDATE "Person" SET email = 'esther.lee@foundry.health'       WHERE email = 'esther@foundry.health';
UPDATE "Person" SET email = 'harry.lee@foundry.health'        WHERE email = 'harry@foundry.health';
UPDATE "Person" SET email = 'henry.luo@foundry.health'        WHERE email = 'henry@foundry.health';
UPDATE "Person" SET email = 'angela.pan@foundry.health'       WHERE email = 'angela@foundry.health';
UPDATE "Person" SET email = 'palash.trivedi@foundry.health'   WHERE email = 'palash@foundry.health';
UPDATE "Person" SET email = 'xiaohan.qian@foundry.health'     WHERE email = 'xiaohan@foundry.health';
UPDATE "Person" SET email = 'mark.liu@foundry.health'         WHERE email = 'markliu@foundry.health';
UPDATE "Person" SET email = 'shea.laws@foundry.health'        WHERE email = 'shea@foundry.health';
```

### TASK-212 — Bulk CSV import: bills + expenses (office manager AP backfill)
**status:** done
**depends on:** TASK-210
**acceptance:**
- [x] `/admin/import/bills` page — drag-drop CSV, Zod-validated rows, preview table with supplier/project match status + duplicate detection on (supplier, invoice number), explicit Commit button
- [x] `/admin/import/expenses` page — drag-drop CSV, matches Person by email + Project by code, preview shows totals + per-person + rejected rows, explicit Commit
- [x] Bills commit defaults `status='paid'` for historical backfill (skips the approval queue); `receivedVia='upload'`; matches Supplier by name if a row exists, otherwise stores `supplierName` free-text
- [x] Expenses commit defaults `status='approved'` with `approvedById=session.person.id` for historical backfill
- [x] Both write one `bulk_imported` AuditEvent per file, single transaction per commit
- [x] Capability gates: `bill.create` for bills, `expense.approve.under_2k` for expenses (acting on behalf of someone else is approval-tier work)
- [x] Both pages reuse the shared `csv-dropzone.tsx` + dry-run preview cache pattern
- [x] `public/templates/bills-template.csv` + `public/templates/expenses-template.csv` shipped + linked from each page
- [x] Landing page `/admin/import` updated to show 4 importer cards (personnel / timesheets / bills / expenses)
- [x] Vitest golden-file tests for both new parsers
- [x] Typecheck + tests + lint green
- [x] Commit: `feat(TASK-212): bulk CSV import for bills + expenses`

**note on completion:** Same pattern as TASK-210 — pure `*WithLookups` builders separated from async wrappers so tests don't mock Prisma. Bills land in `status='paid'`, `receivedVia='upload'`. Expenses land in `status='approved'` with the importer as `approvedById`. Both write one `bulk_imported` AuditEvent per file. Project codes are optional — empty = OPEX; unmatched code = rejection (forces Jas to fix typos rather than silently OPEX-land them). Duplicate detection on bills uses (supplierName + supplierInvoiceNumber); when a duplicate is found, the preview surfaces a skip-vs-force toggle. Expenses don't have a stable duplicate key so no dedup pass for them — Jas dedupes manually.

### TASK-210 — Bulk CSV import: personnel + timesheets (office manager self-serve)
**status:** done
**depends on:** TASK-021, TASK-023
**acceptance:**
- [x] `/admin/import/personnel` page — drag-drop CSV, Zod-validated rows, preview table with `[new|update]` per row + inline errors, explicit Commit button on preview screen
- [x] `/admin/import/timesheets` page — drag-drop CSV, matches Person by email + Project by code, preview shows total rows / hours / per-person summary / rejected rows / duplicates, explicit Commit
- [x] Personnel commit upserts by email (initials auto-derived for new rows, `ensureUniqueInitials` on collisions), audit row written per import in same transaction
- [x] Timesheet commit inserts as `status='approved'` with `approvedById=session.person.id`; duplicate `(person, project, date)` rows handled by skip-or-overwrite toggle (default skip); audit row per import
- [x] Capability gates: `person.create` for personnel; new `timesheet.approve` capability for timesheets (super_admin / admin / partner / associate_partner)
- [x] Shared dropzone + preview pattern (single client component); papaparse for parsing
- [x] Dry-run state stashed in short-lived in-memory cache keyed by token + userId; preview URL `?stage=preview&token=…` is shareable / refreshable for ~10 minutes
- [x] `public/templates/personnel-template.csv` + `public/templates/timesheets-template.csv` shipped + linked from each page
- [x] Row cap 5000 per upload with clear error; massive files rejected
- [x] "Download errors as CSV" link on preview when validation errors exist
- [x] Nav: "Bulk import" item under System group, super_admin / admin only
- [x] Vitest golden-file tests for personnel parser + timesheet parser
- [x] Typecheck + tests + lint green
- [x] Commit: `feat(TASK-210): bulk CSV import surfaces for personnel + timesheets`

**note on completion:** Parser logic split into a pure `*WithExisting` / `*WithLookups` builder (no DB) + an async wrapper that pre-fetches lookups — so the golden-file tests don't need to mock Prisma. The pure layer is what's tested. `jobTitle` is accepted in the personnel CSV (parity with the new-person form) but silently dropped since `Person` has no jobTitle column — comment in the create call explains. Cache is per-process `Map` with 10-min TTL; single-region Vercel deployment makes this fine for the FY26-backfill window. Swap for a `ImportDryRun` DB table later if the surface needs multi-region or longer-than-TTL persistence.

---

## Phase 6 — In-app AI assistant (TT)

> Floating chat widget in the bottom-right of every authed page, mirroring the FeedbackWidget pattern. Powered by Anthropic Claude (existing `ANTHROPIC_API_KEY`). Built in three deployable stages so we can dogfood after each. Per-phase deploy must be confirmed by TT before the next phase starts.
>
> **Product north star (TT, 2026-06-05):** the assistant's primary value is **prepopulating forms from natural-language input** — the user says "log 3h on CAC001 yesterday" or "I spent $48 at Officeworks today for the new monitor cable" and the assistant extracts the structured fields, opens the relevant form pre-filled, and lets the user inspect / edit before submitting. One-shot "submit on confirm" flows (TASK-302 `propose_*`) are secondary — the heavier lift in saved time comes from form prefill, not from skipping the form. Every Phase 2/3 tool should be evaluated against "does this make form prepopulation faster or better?"
>
> **WhatsApp alignment (TT, 2026-06-05):** the in-app assistant and the WhatsApp agent (the existing `whatsapp-router.ts` + TASK-120/121/122) are **two channels on the same underlying agent**, not two agents. Long-term goal: a user typing "log 4h on CAC001 today" gets the same logical handling regardless of channel — same intent classifier, same structured extractor, same capability checks, same audit trail (`source='agent'`). The *interaction model* differs (web can SPA-navigate the user to a prefilled form; WhatsApp can't, so it sends a one-time signed deep-link to the same prefilled form on `ops.foundry.health` — the user opens it on their phone's browser and submits there). The *shared logic* — intent classification, field extraction, project disambiguation, capability gating — must live in one set of modules under `src/server/agents/` and be imported by both surfaces. Concretely: when TASK-301 ships read tools, the existing WhatsApp flow handlers (`parseTimesheet`, `parseAvailability`) get refactored to consume them. When TASK-302 ships `prefill_*` tools, the WhatsApp router stops auto-writing drafts and starts replying with prefilled-form deep links instead. The unification end-state is TASK-303 below.

### TASK-300 — Assistant (Phase 1): conversational helper
**status:** done
**depends on:** TASK-009
**acceptance:**
- [x] Floating chat icon at bottom-right of `(app)/layout.tsx`; click expands a ~400×600 panel with header (close + reset thread), scrollable message thread (markdown rendered), and an input box (Enter sends, Shift+Enter newline, ⌘+Enter also sends). Distinct colour from the feedback pill so the two widgets don't look like dupes; both visible together (feedback shifted left to right-[8.5rem]).
- [x] `AssistantThread` + `AssistantMessage` Prisma models + migration (`20260604000000_add_assistant_thread`). Per-user single-active thread; reset archives the current and creates a new one. Auto-archive after 50 turns.
- [x] `/api/assistant/chat` Next.js route handler: POST `{ message }`, streams Claude response via Server-Sent Events. Persists user message + assistant message in same transaction-bounded sequence (user message saved before streaming starts; assistant message saved after stream completes).
- [x] System prompt in `src/server/agents/assistant/system-prompt.ts` — knows the user's name + roles + the canonical Foundry surfaces (timesheet / bills intake / expenses / approvals / projects / talent / BD outcomes / feedback / admin imports). Hard-prompts 2-3 sentence answers unless user asks for detail. Surface list filtered against user capabilities so the assistant never suggests something they can't do.
- [x] Conversation history capped to last 20 turns for context-window management.
- [x] Token cost guardrails: `max_tokens=4000` per turn; thread auto-archives at 50 turns.
- [x] Rate limit: 100 messages / hour / user, in-memory Map (single-region Vercel is fine for MVP). 429 returned on breach.
- [x] Model: `claude-sonnet-4-5` (matching the rest of the codebase per A4).
- [x] Audit event on every `assistant_thread.created` + `assistant_thread.archived` + `assistant_message.created` (actor=person, source=web). Note: TASK-301 will flip tool-invocation audit events to `source=agent` to match WhatsApp; the message-row audit events stay `source=web` since the conversation itself happened on the web channel.
- [x] Empty / loading / error states: empty thread shows a "Hey — I'm the Foundry Ops assistant…" placeholder; streaming shows a typing-dot indicator; error shows a retry button + inline message.
- [x] Vitest tests: surface-knowledge builder (filters capabilities correctly per role), rate-limit helper, last-20-turn truncation. 15 new tests, full suite 230 passing.
- [x] Typecheck + lint green; commits: `feat(TASK-300): in-app assistant phase 1 — conversational helper` (31d9fb6), follow-up colour fixes (703d1ca, ede6665).
- [x] Smoke: TT signs in, opens the widget, asks "how do I log hours?", gets a sensible answer that mentions /timesheet, and a reload preserves the conversation. Verified on production 2026-06-05.

**Out of scope (lands in TASK-301):** any tool-use / DB lookups.

**note on completion:** Migration applied to production via Supabase SQL Editor (not Prisma CLI — local creds for Supabase weren't in `.env.local`). Prisma's `_prisma_migrations` ledger doesn't know about it; resolve with `pnpm prisma migrate resolve --applied 20260604000000_add_assistant_thread` if/when local DB access is restored. Two follow-up commits adjusted the brand-coloured surfaces (user bubble + send button + collapsed pill) to use `text-white` instead of `text-brand-ink` since the latter (a dark green) was barely readable on the brand-green background.

### TASK-301 — Assistant (Phase 2): read tools (incl. form-prefill foundation)
**status:** doing
**depends on:** TASK-300

**framing:** the read tools serve two purposes — (1) answer "what's on my plate" style questions, and (2) **resolve the ambiguous references in natural-language input** so the prefill flow in TASK-302 has clean structured data to work with. e.g. when the user says "log 3h on CAC yesterday", the assistant uses `find_project("CAC")` to disambiguate (CAC001? CAC002?) before opening a prefilled timesheet form. Every find/list tool should return enough metadata (ids, codes, names, dates, status) that downstream prefill tools can reference rows without a second roundtrip.

**acceptance:**
- [x] Add Anthropic `tools` array to the chat call. One file per tool under `src/server/agents/assistant/tools/`:
  - [x] `list_my_approvals()` — pending approval rows where `requiredRole ∈ session.roles`
  - [x] `list_my_projects()` — projects the user is on (team membership) or leads (primary partner / manager); returns id, code, name, clientCode, stage so it's a good prefill index
  - [x] `get_my_hours_this_week()` — sum + per-project breakdown from `TimesheetEntry`
  - [x] `find_project(query)` — fuzzy match on code or name; returns top-5 with id/code/name/client for disambiguation
  - [x] `find_person(query)` — fuzzy match on name / initials / email; redacts fields the requester can't see (e.g. rate)
  - [x] `get_my_expenses_recent(n)` — last N submissions
  - [x] `list_expense_categories()` — enum values + short labels
  - [x] `get_active_rate_card_for_role(roleCode)` — gated on `ratecard.view`
- [x] Each tool is a pure server-side function gated on session; no privilege escalation. Capability gating built into the registry's `runAssistantTool` — `get_active_rate_card_for_role` carries the `ratecard.view` cap.
- [x] Tool-result loop: assistant receives tool result, formats human answer. Implemented in [chat.ts](src/server/agents/assistant/chat.ts) with `MAX_TOOL_ROUNDTRIPS=5` guard.
- [x] Tool calls audited (`assistant_tool.invoked`, delta = `{ tool, input }`, source=agent so the audit-log filter unifies in-app + WhatsApp agent actions).
- [x] **WhatsApp parity:** factored `classifyIntent`, `parseTimesheet`, `parseAvailability` out of [whatsapp-router.ts](src/server/integrations/whatsapp-router.ts) into [src/server/agents/intent/](src/server/agents/intent/). Behaviour unchanged on the WhatsApp channel (verified via the existing flow logic). Tests for the keyword fallback added.
- [x] Tests: registry sanity (8 tools, unique names, valid schemas), capability gating, input validation, intent-classifier keyword fallback. Full suite 246 ✓ (was 230 before this task).
- [ ] Commit: `feat(TASK-301): in-app assistant phase 2 — read tools + WhatsApp extractor refactor`.
- [ ] Smoke: TT asks "what's on my plate?" and gets a real answer pulled from the DB. Also: "what's CAC?" returns the right project + ready to be referenced in a follow-up prefill. And: a WhatsApp timesheet log still works end-to-end after the extractor refactor (no behavioural change on that channel yet).

### TASK-302 — Assistant (Phase 3): form prefill + confirmation-gated quick actions
**status:** in-progress (split into 302a / 302b / 302c / 302d below)
**depends on:** TASK-301

**framing:** primary capability is **prefilling existing forms from natural language**, not bypassing forms. The assistant extracts structured fields from chat ("3h on CAC001 yesterday with note 'pricing analysis'") and opens the relevant form (`/timesheet`, `/expenses/new`, `/invoices/new`, etc) with those values already populated — the user inspects / edits / submits via the form's normal flow. The form's existing server action is the only write path; the assistant never writes directly. This pattern has two big wins over a confirmation-card-only model: (a) the user gets to inspect *all* fields, including ones the assistant didn't try to fill, (b) any future schema or validation change on the form Just Works.

A secondary, smaller surface of `propose_*` tools handles low-field one-shot actions (quick recruit, feedback ticket) where there isn't a meaningful "form to inspect."

**acceptance — prefill family (primary):**
- [ ] `prefill_*` tool family — each returns a structured `{ url, payload, summary }` triple. The widget renders an inline card with the assistant's text summary + a primary button ("Open prefilled timesheet"). Click → SPA-routes to the form with values pre-loaded.
  - `prefill_timesheet({ entries: [{ projectCode, date, hours, notes? }] })` → opens `/timesheet?week=…&prefill=<token>` with rows pre-populated
  - `prefill_expense({ date, amountDollars, gstDollars?, category, vendor?, description, projectCode? })` → opens `/expenses/new?prefill=<token>`
  - `prefill_bill({ supplierName, supplierAbn?, supplierInvoiceNumber, issueDate, dueDate, amountDollars, gstDollars?, category, projectCode? })` → opens `/bills/new?prefill=<token>`
  - `prefill_invoice({ projectCode, lines: [{ label, amountDollars }] })` → opens `/invoices/new?projectId=…&prefill=<token>`
- [ ] Prefill payload lives in a short-lived server-side store (new `AssistantPrefill` table OR encrypted/signed token in the URL — TBD; signed-token is simpler unless the payload outgrows ~2KB). 15-min TTL; single-use (consumed on first form render).
- [ ] Form pages read the `prefill=<token>` query param, fetch + hydrate the payload, surface a one-time "Prefilled by Assistant" banner above the form with an "x" to dismiss + an "undo" that empties the fields. Banner is the user's visual cue that *they* are still the actor.
- [ ] Validation runs the same as a hand-typed form — the assistant doesn't get to bypass any Zod refinement. If the prefilled values fail validation, the user sees the same inline errors and edits to fix.
- [ ] Capability gating belongs to the form's existing server action — the assistant can suggest opening a form the user can't submit (e.g. an invoice for a partner who only has `invoice.create` and not `invoice.approve.over_20k`), and the form will refuse the eventual submit cleanly.

**acceptance — propose family (secondary, low-field one-shot):**
- [ ] `propose_*` tools return a structured "confirmation card" payload (not a write). Widget renders the card inline; nothing happens until user clicks Confirm.
  - `propose_quick_recruit({ firstName, lastName, band, ownerInitials })` — single-button flow, no form needed
  - `propose_feedback_ticket({ urgency, kind, title, body })` — confirms the feedback ticket text before logging
- [ ] Confirmation cards carry a stable `proposalId`; the Confirm POST re-validates capability + executes the underlying existing action.
- [ ] No write occurs without explicit click; proposal payload TTL 15min.

**acceptance — shared (both families):**
- [ ] Every successful execution writes an `AuditEvent` with `actorType='person'` (user is the actor; the assistant is just a UI), `source='agent'` (matches the WhatsApp router's attribution), tagging `assistant.proposalId` / `assistant.prefillId` in the delta.
- [ ] Tests: each prefill tool round-trips through to a form render with the right fields populated; each propose tool's Confirm enforces capability.
- [ ] **Phase 3 doesn't merge until Phase 2 has been in production for at least a day** per spec.

**acceptance — WhatsApp parity (lock-step, not optional):**
- [ ] For every web `prefill_*` tool, the WhatsApp router gets the same prefill path. Concretely:
  - Today's WhatsApp timesheet flow auto-writes a `draft` TimesheetEntry and tells the user "review on the web."
  - After TASK-302: the WhatsApp router calls the same `buildTimesheetPrefill(...)` builder, generates the one-time signed token, and replies with `Tap to review + submit: https://ops.foundry.health/timesheet?prefill=<token>`. Same prefill banner + inspection UX as the web user. *No draft is auto-written* — the form's normal submit creates the row.
  - Same shape for expense, bill (when WhatsApp gets bills), and any later prefill_* surface.
- [ ] The legacy "auto-draft" behaviour stays available behind a feature-flag config row (`whatsapp.autoWriteDrafts`) for the rollout window, default off after this task ships. If TT decides phone-first folks prefer the auto-draft round-trip, flip it back on per-flow.
- [ ] WhatsApp signing: the prefill token in the URL is signed with a server secret (HMAC-SHA256) so a forwarded link can't be used to inject values into anyone else's session. Token also encodes `personId` so the form refuses to render if the opener isn't that person.

- [ ] Commit: `feat(TASK-302): in-app assistant phase 3 — form prefill + WhatsApp parity`.

**Out of scope (defer per spec):** voice/TTS, image upload, cross-user assistants, custom personas, slash-command palette.

**Future ideas (post-302, capture here so they don't get lost):**
- Receipt-attached prefill — drag a receipt onto the assistant pill, OCR extracts fields (reuse `extractIntakeFields`), assistant prefills `/expenses/new` or `/bills/new`. Needs image upload (currently out of scope).
- Multi-row prefill for the timesheet — "log my standard week" expands the user's `regularDays*` config into 5 prefilled rows.
- Invoice line synthesis from approved timesheets + rate card — "draft an invoice for CAC001 for May" reads timesheet entries × rate card → prefills lines (this is the boundary with TASK-094 Invoice Drafter agent; the assistant *suggests*, the drafter agent *generates*).

### TASK-302a — Phase 3 foundation + timesheet prefill
**status:** doing
**depends on:** TASK-301
**acceptance:**
- [x] `src/server/agents/assistant/prefill/token.ts` — HMAC-SHA256 signed tokens carrying `{ v, kind, personId, payload, iat, exp, jti }`. Signing key derived from `AUTH_SECRET` via domain-separated HMAC; no new env var. 15-min TTL. `verifyPrefillToken(token, { personId, kind })` rejects on signature mismatch, expiry, personId mismatch, or wrong kind.
- [x] Payload schemas under `src/server/agents/assistant/prefill/schemas.ts` — Zod per surface. Timesheet first (`{ entries: [{ projectCode, dateIso, hours, notes? }] }`); expense / bill / invoice schemas pre-declared for TASK-302b.
- [x] `prefill_timesheet` tool — registered in the assistant tool registry. Cross-checks codes exist + aren't archived BEFORE returning a URL (catches hallucinated codes early). Picks `week=` from earliest entry. Returns `{ kind: 'prefill', surface: 'timesheet', url, summary, entryCount, weekIso }`.
- [x] `/timesheet` page reads `?prefill=<token>`, verifies signature + binds to current session's personId, merges entries via `applyTimesheetPrefill`. Stacks hours when row already present; appends a new row when not. Invalid / expired / wrong-person tokens render the page as normal with a small notice.
- [x] `PrefillBanner` component above the grid: "Prefilled by Assistant · <summary> · [Undo] [Dismiss]". Undo navigates to the same URL without the prefill param. Skipped rows surface inline.
- [x] Widget renders new SSE event kind `prefill_card` as an inline card with summary + "Open prefilled timesheet" button. Sits in the streaming message bubble alongside text + tool chips.
- [x] Audit on mint (`assistant_prefill` action=`minted` source=`agent`) AND on redemption (action=`redeemed` source=`agent`) — pair gives full traceability.
- [x] Tests: token sign + verify round-trip, rejected on wrong person / wrong kind / expired / tampered / malformed (8 tests). `applyTimesheetPrefill` golden tests covering merge, stacking, locked row refusal, out-of-range, unknown code, immutability (8 tests). Updated assistant-tools registry test to include `prefill_timesheet`. Full suite 262 ✓.
- [x] System prompt v3: introduces the prefill family; spells out the "find_project → prefill" pattern; tells the model NOT to paste URLs inline (widget renders the button).
- [ ] Commit: `feat(TASK-302a): assistant phase 3a — prefill foundation + timesheet`.
- [ ] Smoke: TT says "log 3h on CAC001 today" → assistant calls find_project, then prefill_timesheet, then renders a button; click → `/timesheet?week=…&prefill=…` opens with that row pre-populated and the banner visible.

### TASK-302b — Prefill the other money forms (expense, bill, invoice)
**status:** doing
**depends on:** TASK-302a
**acceptance:**
- [x] `prefill_expense` tool + `/expenses/new` hydrates from token + banner + audit redeem. Category cross-checked against canonical enum; project code checked when supplied; OPEX fallback when blank.
- [x] `prefill_bill` tool + `/bills/new` hydrates from token + banner + audit redeem. Gated on `bill.create` capability.
- [x] `prefill_invoice` tool + `/invoices/new` hydrates from token + banner + audit redeem. Gated on `invoice.create`. Project code resolved → projectId; lines passed as initialValues for the controlled lines state.
- [x] Reuses token + banner infra from 302a — no schema or signing changes.
- [x] System prompt v3.1: introduces all four prefill tools + example phrasings + when-to-call rules.
- [x] Tests: payload schema accepts valid + rejects malformed per surface (15 tests); assistant-tools registry test updated to include all 4 prefill tools. 277 ✓ (was 262).
- [ ] Commit: `feat(TASK-302b): assistant prefill — expense + bill + invoice`

### TASK-302c — WhatsApp prefill parity
**status:** doing
**depends on:** TASK-302a, TASK-302b
**acceptance:**
- [x] WhatsApp timesheet flow stops auto-writing a draft TimesheetEntry by default. Parses text via the shared `parseTimesheetText` extractor, signs a `prefill_timesheet` token, replies with the absolute `NEXT_PUBLIC_APP_URL/timesheet?week=…&prefill=…` URL. Token bound to the WhatsApp sender's Person.id so a forwarded link refuses.
- [x] WhatsApp expense flow: OCR still runs (existing extractIntakeFields), result becomes a `prefill_expense` token URL instead of a submitted Expense row. Caption text becomes the description; project code parsed from caption pre-populates `projectCode`.
- [x] Legacy auto-draft path retained behind `WHATSAPP_AUTO_WRITE_DRAFTS=1` env var (kept simple — env flag instead of a DB FeatureFlag row since the feature-flag table doesn't exist yet). Default off after this task. If TT decides phone-first folks prefer the auto-draft round-trip, flip the env var on (no code change needed).
- [x] Audit event `assistant_prefill` action=`minted` source=`agent`, delta tags `channel: 'whatsapp'` so a single SQL filter sees mints from both channels.
- [x] HELP_TEXT updated so the menu accurately describes the new behaviour.
- [ ] Commit: `feat(TASK-302c): WhatsApp prefill parity — deep-link instead of auto-draft`

**Not changed:** the WhatsApp availability flow (`parseAvailabilityText` → auto-writes `AvailabilityForecast` rows) — there's no `prefill_availability` tool yet, and the availability table is multi-day so a single prefill token doesn't map cleanly. Future task: add `prefill_availability` if the auto-write behaviour proves unpopular.

### TASK-302e — Drag-drop file attachments (receipt → expense/bill prefill)
**status:** doing
**depends on:** TASK-302b
**acceptance:**
- [x] Drag a file onto the assistant panel — panel shows full-bleed drop overlay ("Drop receipt or invoice · PDF or image · up to 10MB"). MIME allowlist: PDF + JPEG + PNG + HEIC + WebP. Other types rejected inline.
- [x] One file per message (MVP). Dropping a second replaces the first.
- [x] Attachment chip in the composer above the textarea: "📎 receipt.pdf · 1.2MB · application/pdf · [✕]". Click ✕ removes before send.
- [x] On send, widget POSTs multipart/form-data to `/api/assistant/chat`. Optional text alongside the file ("this is for ARC001").
- [x] `/api/assistant/chat` extended: detects content-type, parses multipart, validates file (mime + size), runs `extractIntakeFields` (existing OCR pipeline), emits `attachment_extracted` SSE event with the structured extraction, and INLINES the extraction into the user message Claude sees so it has full context.
- [x] Persisted user message records the attachment + extraction summary so reload preserves replay: `[attached file: receipt.pdf · application/pdf · Officeworks · $48.50 · conf 92%]\nextraction: {...}\n\n<user text>`. Original binary NOT stored (SharePoint sync ships later).
- [x] Widget renders attachment chips in user bubble: "📎 ⋯ receipt.pdf · uploading" → "📎 ⋯ receipt.pdf · extracting fields…" → "📎 ✓ receipt.pdf · Officeworks · $48.50 · 2026-06-05 · conf 92%". Below it: normal text + tool chips + prefill card flow.
- [x] System prompt v3.2 — explains the structured-extraction format + heuristics for expense-vs-bill routing + confidence-band advice + "ask if ambiguous" fallback.
- [x] OCR cost guardrail: files > 8MB skip OCR (still pass through with a "too large to OCR" summary so the user knows). Hard 10MB cap on upload.
- [x] Audit event `assistant_attachment` action=`extracted` source=`agent`, delta carries filename + mimeType + size + confidence.
- [ ] Commit: `feat(TASK-302e): assistant — drag-drop receipt → OCR → prefill`.
- [ ] Smoke: TT drags a real receipt PDF onto the assistant + types "this is for ARC001 reimburse me" → expects extraction chip → expense prefill card → click → `/expenses/new` opens with all fields populated.

**Out of scope (future):** CSV → bulk timesheet attachment (bulk import surface at `/admin/import/timesheets` already handles this — assistant could deep-link there instead). Original binary upload to SharePoint. Multi-file per message. Word doc / Excel parsing.

### TASK-302d — Propose tools (quick recruit + feedback ticket)
**status:** doing
**depends on:** TASK-302a
**acceptance:**
- [x] `propose_quick_recruit` + `propose_feedback_ticket` tools registered in the assistant catalogue. Each returns `{ kind:'proposal', surface, token, title, fields, confirmLabel, summary }`. Token uses the same HMAC primitive as prefill (re-used `signPrefillToken`), with new kinds `recruit_proposal` + `feedback_proposal` added to the `PrefillKind` union. 15-min TTL, personId-bound, jti nonce.
- [x] Widget renders confirmation cards inline with Confirm + Cancel. Card shows title + labelled fields. On Confirm: pending → confirming → confirmed (with "Open →" link to the created entity) or failed (with error). Cancel removes the card from the message.
- [x] `/api/assistant/confirm` POST route — verifies token (signature + personId + kind + expiry), capability-checks (`recruit.manage` for quick recruit; feedback is open to any authed user), runs the underlying create inside a transaction with `source='agent'` audit.
- [x] Audit chain: mint = `assistant_proposal` action=`proposed` source=`agent`; create = `recruit_prospect` / `feedback_ticket` action=`created` source=`agent` delta tags `via: assistant_proposal` + jti so the trail is end-to-end traceable.
- [x] System prompt v3.3 — introduces the propose family + example phrasings + lowercase snake_case band values.
- [x] Tests: assistant-tools registry includes both new tools (14 total). Full suite 277 ✓.
- [ ] Commit: `feat(TASK-302d): assistant propose tools — quick recruit + feedback ticket`

### TASK-303 — Unify in-app assistant + WhatsApp router behind one agent loop
**status:** todo
**depends on:** TASK-302

**framing:** end-state for the alignment work started in TASK-301 and TASK-302. Today the WhatsApp router is a hand-coded flow machine: intent classifier → fixed state machine per flow → bespoke extractor per flow. The in-app assistant is a Claude-with-tools chat. After TASK-301 and TASK-302 they share extraction modules, prefill builders, and tool definitions — but the WhatsApp side still has the old flow machinery wrapped around them. This task replaces the flow machinery with the **same Claude-with-tools loop** the web uses: one system prompt (channel-aware), one tool array, one conversation persistence shape. The result is that adding a new capability lights it up on both channels in one PR.

**acceptance:**
- [ ] `src/server/agents/assistant/loop.ts` — channel-agnostic agent loop. Takes a `Channel` discriminator (`'web' | 'whatsapp'`), session, conversation id, new message; runs the same tool-use loop. Channel shapes the system prompt (web mentions /paths, WhatsApp mentions deep-links + "tap the link"), and the rendering of tool results (web returns structured JSON for the widget, WhatsApp returns plain text + the deep link).
- [ ] `WhatsAppConversation` storage can replace `AssistantThread` for the WhatsApp side — OR the two get unified into a single `AgentThread` table with a `channel` column. Pick whichever causes less churn at this point.
- [ ] WhatsApp flow handlers (`handleTimesheet`, `handleAvailability`, `handleExpense`, `handleStatusCheck` in [whatsapp-router.ts](src/server/integrations/whatsapp-router.ts)) deleted — their work is now done by the shared tool implementations. The router file shrinks to: receive message → resolve person → enqueue into the agent loop → write the reply back to WhatsApp.
- [ ] Intent classifier becomes optional — the Claude-with-tools loop natively reasons about which tool to call, so the haiku-prefilter only stays if it gives a measurable cost win on idle small-talk.
- [ ] All existing WhatsApp behaviours preserved: ✅ "Logged 4h on PROJ001 today" still works; ✅ receipt photos still create an expense draft (or, post-302, a prefill deep link); ✅ "menu" / "cancel" still behave the same; ✅ unknown senders still refused.
- [ ] All existing WhatsApp tests still pass; new tests cover the unified loop against fixture web + fixture WhatsApp messages with the same input → same DB outcome.
- [ ] Commit: `feat(TASK-303): unify assistant + WhatsApp behind one agent loop`.

**Why this is deferred (not for MVP):** TASK-303 is real architectural work — best done after Phase 1 + Phase 2 + Phase 3 have been in real use for at least a week and we have evidence the shared shape actually fits both channels (vs an assumed alignment that breaks when an edge case shows up). Setting it up now would also tangle with TASK-080 (Inngest workflow framework) if that lands first. Keep the alignment principles enforced via TASK-301 + TASK-302 acceptance criteria so we don't drift in the meantime.

---

*End of TASKS.md. Start with TASK-001.*
