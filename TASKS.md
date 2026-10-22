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
- [x] Receipt upload → SharePoint — **TASK-042b landed 2026-07-02** (commit `3565362`). `/expenses/new` now has a file input; upload runs before the Bill/Expense tx via `uploadReceiptToSharePoint`; graceful degradation if Graph is down. See INTEGRATIONS.md §1 for the folder layout. Backfill script + proxy inline preview shipped in `372338b`.
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
- [x] File upload → SharePoint — **TASK-046b landed 2026-07-02** (commit `372338b`). `/bills/new` accepts a file (precedence over the pasted URL) and `/bills/intake` no longer stores base64 inline — both branches upload via `uploadReceiptToSharePoint`. `/api/attachments/bill/[id]` proxies binary content for inline preview during approval. Pending: AP autoharvest (TASK-093) attachment archival — the mail-intake module is not on current HEAD (stranded on `feat/task-093-mail-intake-autoharvest`); apply once re-integrated.
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
**status:** done
**depends on:** TASK-050
**acceptance:**
- [x] Job writes .xlsx to SharePoint via `uploadWorkbookToSharePoint` → `<ReportsRoot>/<WorkbookName>.xlsx` (`resolveReportsRoot`: `SHAREPOINT_REPORTS_ROOT` → `<SHAREPOINT_ADMIN_ROOT>/04 Reports` → Financial default). Returns null (graceful skip) when Graph unconfigured.
- [x] Overwrites atomically: workbook uploads to a temp `.<name>.xlsx.tmp-<stamp>`, then the published copy is deleted and the temp renamed onto the final name — a reader never sees a half-written file at the published path.
- [x] Uses SheetJS (`xlsx`, already a dependency) — no proprietary template. Pure `buildWorkbookBuffer(sheets)` builder (numeric cells stay numeric, auto column widths, 31-char sheet-name sanitise + dedup) split from the Graph publish so it's unit-testable.

**note on completion:** `src/server/exports/excel-workbook.ts` + `src/__tests__/excel-workbook.test.ts` (10 tests, round-tripped through `XLSX.read` to prove valid .xlsx). "ExcelJS or equivalent" satisfied with SheetJS to avoid a new dependency. Graph primitives duplicated from `sharepoint-backup.ts` per the standing TASK-042c extract-to-shared-module note. Consumed by TASK-069c (master-ledger workbook).

### TASK-061 — Workbook: Finance.xlsx
**status:** done
**depends on:** TASK-060
**acceptance:**
- [x] Sheets: P&L, Cash, AR aging, AP aging (`src/server/exports/finance-workbook.ts`, drawing on `computeFirmPnL` / `computeCashflow` / `computeFirmAging` / `computeFirmApAging` — the same aggregators the on-screen reports use, so the workbook can't drift). Money numeric; P&L carries a TOTAL row.
- [x] Nightly (data-export cron) + on-demand "Regenerate report workbooks" button on `/admin/exports`, via the shared `report-workbooks.ts` registry + runner. Publishes `Finance.xlsx` to the Reports folder (TASK-060 atomic overwrite); each run audited (`report_workbook_generated`/`_failed`), graceful skip when Graph unconfigured.
- [ ] Commit: `feat(TASK-061): Finance.xlsx workbook` — batched

**note on completion:** introduced `report-workbooks.ts` — a registry the cron + admin button both loop over, so TASK-062…066 each land as one registry entry (no per-task cron/button wiring). Pure `financeSheets(pnl,cash,ar,ap)` split out for tests (`finance-workbook.test.ts`). Full suite green (469).

### TASK-062 — Workbook: Timesheet.xlsx
**status:** done
**depends on:** TASK-060
**acceptance:**
- [x] Sheets: by person, by project, utilisation (`src/server/exports/timesheet-workbook.ts`; utilisation reuses `computeFirmUtilisation`)
- [x] Covers current FY + last FY (`financialYearWindow` — AU FY, approved/billed entries only)
- [x] Registered in `report-workbooks.ts` (nightly cron + admin regenerate button pick it up automatically); pure `timesheetSheets` split for tests (`timesheet-workbook.test.ts`)
- [ ] Commit: `feat(TASK-062): Timesheet.xlsx workbook` — batched

### TASK-063 — Workbook: Invoices.xlsx
**status:** done
**depends on:** TASK-060
**note:** `invoicesSheet` / `buildInvoicesWorkbook` in `src/server/exports/list-workbooks.ts` (full AR list: number, client, project, status, dates, ex-GST/GST/total, paid, Xero). Registered in `report-workbooks.ts`; pure builder tested (`list-workbooks.test.ts`).

### TASK-064 — Workbook: Expenses.xlsx
**status:** done
**depends on:** TASK-060
**note:** `expensesSheet` / `buildExpensesWorkbook` (date, submitter, category, vendor, project/OPEX, status, amount, GST). Registered + tested.

### TASK-065 — Workbook: Pipeline.xlsx
**status:** done
**depends on:** TASK-060
**note:** `pipelineSheet` / `buildPipelineWorkbook` from `computeAdminBdPipeline` (code, name, stage, sector, client, expected, probability, weighted, owner, target close, age). Registered + tested.

### TASK-066 — Workbook: Partner-pool.xlsx
**status:** done
**depends on:** TASK-060
**note:** `partnerPoolSheets` / `buildPartnerPoolWorkbook` from `computePartnerScoreboard` — Full partners + Associate partners sheets (clients led, projects, invoiced, WIP, margin, deals, pipeline, hours). Registered + tested.

### TASK-067 — Remove "2-way synced" language
**status:** done
**depends on:** TASK-060
**acceptance:**
- [x] No "2-way synced" language exists in the build — the prototype's Excel "synced" wording was never ported (A1 established read-only snapshots); export surfaces already say "Snapshot / regenerate / Run export now". Remaining `synced` strings are legitimate Uber/Navan/Xero integration syncs, unrelated to exports.
- [x] Last-snapshot timestamp visible on `/admin/exports` (recent-runs table, `formatLocalDateTime`). Broadened the recent-runs query to also include the report-workbook + master-ledger backups (`report_workbook_*` / `ledger_backup_*`) so the timestamp covers every 365 backup, not just the continuity ZIP.

### TASK-068 — Persist finalised invoice PDF to SharePoint
**status:** done
**depends on:** TASK-045
**acceptance:**
- [x] Add `taxInvoiceSharepointUrl String?` + `taxInvoiceDriveItemId String?` to `Invoice` in `prisma/schema.prisma`; migration `prisma/migrations/20260731000000_add_invoice_sharepoint_pointer/` (needs manual `prisma migrate deploy` against prod — migrations don't auto-run here)
- [x] On finalise (`finaliseInvoice` in `src/app/(app)/invoices/[id]/preview/actions.ts`), render via `renderInvoicePdfWithReceipts` and upload to SharePoint via `uploadInvoicePdfToSharePoint` (new, in `src/server/integrations/sharepoint-receipts.ts`); store the returned webUrl + driveItemId on the `Invoice` alongside `taxInvoiceFinalisedAt`. **Folder:** `<RECEIPTS_ROOT>/FY YY - YY+1/Invoices/YYYY-MM/` (sibling to the Bills/Expenses receipt buckets). **Deviation:** targeting the per-project admin/financial folder (`Project.sharepointAdminFolderUrl`) was *not* implemented — it needs a webUrl→drive-path resolver we don't have; the date-partitioned Invoices tree is itself audit-complete. Left as a follow-up (see TASK-068b below).
- [x] Graceful degradation when Graph is down: finalise still succeeds, pointer stays null, upload retried on the next finalise call (short-circuit only once *both* finalised-at and URL are set), audited with `archiveSkipped` — mirrors TASK-042b/046b
- [x] Audit event carries `via: 'tax_invoice_archived'` + the SharePoint URL in the delta on success (A9); `via: 'tax_invoice_finalised'` + `archiveSkipped: true` when archival was skipped
- [x] Invoice detail page shows a "View in SharePoint ↗" link when the pointer is present
- [x] Tests: `src/__tests__/sharepoint-receipts-helpers.test.ts` (invoiceFolderPath + buildInvoiceFilename); `src/__tests__/invoice-finalise.test.ts` (archived / Graph-down / retry / short-circuit branches — asserts URL persisted + audit `via`)
- [ ] Commit: `feat(TASK-068): persist finalised invoice PDF to SharePoint` — **not yet committed**; working tree also holds unrelated in-flight bulk-import WIP, so a per-task commit needs hunk-level staging (see note)

**context:** Raised by TT 2026-07-30. Today invoices are rendered on-demand and streamed as a download only — nothing lands in 365 (unlike bill/expense receipts, which upload via `sharepoint-receipts.ts`). This closes that gap and gives the master ledger (TASK-069) a stored-file link column. HANDOFF.md:271 describes the intended "rendered doc in SharePoint" — this is the concrete build of it (PDF, not .docx).

**note on completion:** typecheck + lint + full suite green (417 tests). Migration is hand-authored and **must be applied manually** to prod (`prisma migrate deploy`) — nothing auto-runs it here; until then the two new columns are absent (P2021 on read). Commit deferred: the branch working tree has a large unrelated bulk-import dry-run feature uncommitted (the `admin/import/*`, `imports/*`, `bulk-csv.ts`, `ImportDryRun` model + `20260729…` migration, `grant_jas_admin.ts`), so TASK-068 was not swept into a blanket commit — awaiting direction on isolating it.

### TASK-068b — Invoice archival: target the per-project admin/financial folder
**status:** done
**depends on:** TASK-068
**acceptance:**
- [x] `archiveInvoicePdf` files the finalised PDF into `Project.sharepointAdminFolderUrl` when set, else the `Invoices/FY …` tree from TASK-068; an admin-folder failure falls back to the tree rather than losing the archive. Wired into `finaliseInvoice` (selects `project.sharepointAdminFolderUrl`).
- [x] Folder resolution uses Graph's `/shares/{token}/driveItem` (webUrl → sharing token → DriveItem `{driveId, itemId}`) rather than fragile URL-path parsing; upload addresses the folder by item id (`uploadSmallFileToItem` / `uploadLargeFileToItem`). Reuses the existing `buildInvoiceFilename` + Graph primitives in `sharepoint-receipts.ts`.
- [x] Tests: `encodeSharingToken` round-trip unit test (the resolver's pure core); `finaliseInvoice` test asserts the admin folder URL is passed through to the archiver when set
- [ ] Commit: `feat(TASK-068b): file finalised invoices into the project admin folder`

**context:** Split out of TASK-068 — the original acceptance asked for the project admin folder, but that needs a webUrl→drive resolver Foundry Ops didn't have. TASK-068 shipped the audit-complete date-partitioned tree; this adds the per-project placement on top.

**note on completion:** used the `/shares` sharing-token approach instead of parsing the webUrl path (encodes any SharePoint URL → DriveItem in one call; robust to site-path + library-name + URL-encoding variance). `filename` sanitisation + FY logic reused from TASK-068. Typecheck + lint clean; full suite green (466 tests). Same manual-migration caveat as TASK-068 (the invoice pointer columns) still applies.

### TASK-069 — Master ledger: unified AR/AP aggregation module
**status:** done
**depends on:** TASK-053, TASK-054, TASK-055
**acceptance:**
- [x] `src/server/reports/ledger.ts` exposes `buildLedger(session, filters)` returning normalised rows across **every money flow in and out**: Invoices (AR / in) incl. `paymentReceivedAmount` (→ `amountPaidCents`), Bills (AP / out), Expenses (reimbursables / out), PayRun + PayRunLine (payroll / super / contractor-AP / supplier-AP / out), ContractorInvoice (project cost / out), and BankTransaction (bank in/out from the Xero feed; direction from signed amount)
- [x] Each `LedgerRow` carries every audit-relevant field: `direction`, source type + id, counterparty name + ABN, project/client code + **derived internal code** (`deriveInternalCode` — FHB/FHP/FHO/FHX prefix; first-present-candidate decides; never merges `*000`), category / cost centre, issue/due/paid dates, ex-GST / GST / total (integer cents) + currency, status, Xero id, payment reference + BSB + account (from `PayRunLine`), `rebillable` + `rebilledOnInvoiceId`, file pointer (SharePoint), created/updated, and the latest `AuditEvent` actor/action/at (merged for invoice/bill/expense)
- [x] Money stays integer cents through aggregation (serialise later in TASK-069c)
- [x] Deterministic ordering (primary date desc, then source type, then id)
- [x] Per-source `map*` fns are pure + exported; golden test covers one row of each source type + direction sign + internal-code derivation; `buildLedger` integration test over mocked Prisma covers assembly, ordering, audit overlay, payee-name resolution, and the capability gate
- [x] Also added capabilities `report.ledger.view` / `report.ledger.export` (both `super_admin`+`admin`) — consumed by 069b/069c; `buildLedger` enforces `report.ledger.view` as defence-in-depth
- [ ] Commit: `feat(TASK-069): master ledger aggregation module` — batched with the rest of the ledger series

**note on completion:** `src/server/reports/ledger.ts` + `src/__tests__/ledger.test.ts` (18 tests). PayRunLine has no Person relation, so payee names are batch-resolved by id inside `buildLedger`. PayRun/bank rows aren't project-tagged, so a project/client filter excludes them by design. `SOURCE_TAKE_CAP=20_000` guard per source with a `console.warn` on hit (no silent truncation).

**context:** TT 2026-07-30 decisions — **(1) scope = comprehensive** (all flows in and out, not just Bills+Invoices); the accountant/audit ledger must reconcile against Xero, so every counterparty/date/GST/code/Xero-id field is required. This module is the single source both the in-app tab (TASK-069b) and the export (TASK-069c) read from — build it once, no duplicate query logic.

### TASK-069b — Master ledger: in-app reporting tab (live)
**status:** done
**depends on:** TASK-069
**acceptance:**
- [x] Capability `report.ledger.view` (`['super_admin','admin']`, covers Jas) added in TASK-069; page gates via `hasCapability` → `notFound()`, and `buildLedger` re-checks it server-side
- [x] `/reports/ledger` renders the ledger **live from the DB** via `buildLedger` — always current, no snapshot dependency
- [x] Server-side filters via the shared `parseLedgerFilters`: direction, date range (inclusive `to`), source type, project/client, status — GET form so the URL is shareable and the export links inherit scope
- [x] All TASK-069 columns; bank BSB/account **masked to last 3 digits** on-screen (`maskTail`); full values only in the gated export
- [x] Empty state (in-page), loading state (`loading.tsx`), error state (`error.tsx`) all present
- [x] "Export CSV / Excel" controls link to the TASK-069c endpoints (scope-preserving); on-demand "Back up to 365" button (gated on `report.ledger.export`)
- [x] Nav entry "Master ledger" in the Reports group, `roles: ['super_admin','admin']` (matches the capability)
- [x] Tests: filter-reducer unit test (`ledger-filters.test.ts`); the capability gate is covered by `buildLedger`'s test (069) + the route gate test (069c)
- [ ] Commit: `feat(TASK-069b): master ledger reporting tab` — batched with the ledger series

**note on completion:** the on-demand backup button lives on the ledger tab rather than `/admin/exports` (which is `integration.manage` / super_admin-only) so plain admins (Jas's tier) can trigger it. Route `/api/reports/ledger` built in 069c.

### TASK-069c — Master ledger: Excel/CSV export + nightly SharePoint backup
**status:** done
**depends on:** TASK-069, TASK-060
**acceptance:**
- [x] Capability `report.ledger.export` (`['super_admin','admin']`) added in TASK-069; `/api/reports/ledger` requires it (403 otherwise)
- [x] `?format=csv` streams RFC-4180 CSV (`ledgerToCsv`); `?format=xlsx` streams a workbook via the TASK-060 infra with sheets **All / Receivables (in) / Payables (out)** (`ledgerToWorkbook`). Full payment refs + BSB + account included — PII-bearing, the capability is the control. One `COLUMNS` definition drives both formats (money as decimal string in CSV, numeric dollars in xlsx).
- [x] Every download writes an `AuditEvent` (`action: 'exported'`, `via: 'ledger_export_downloaded'` — actor, format, row count, filter delta)
- [x] Nightly + on-demand SharePoint backup (`generateLedgerBackup`): publishes `Master-Ledger.xlsx` to the Reports root via TASK-060's atomic overwrite. Wired into the `data-export` cron (system actor, best-effort — never fails the cron) + the on-demand tab button (person actor). **Deviation:** a single always-current copy at a stable Reports path rather than dated files in the backups root — better for Jas (stable link) and dated history is already captured by the nightly data-export ZIP.
- [x] Backup audited (`ledger_backup_generated` / `ledger_backup_upload_failed`); graceful skip when Graph unconfigured (`uploadSkipped`)
- [x] Tests: route capability-gate test (403); CSV + xlsx header / row-count / numeric-money assertions (`ledger-export.test.ts`)
- [ ] Commit: `feat(TASK-069c): master ledger export + SharePoint backup` — batched with the ledger series

### TASK-069d — Direct "Open in 365" links wherever a SharePoint pointer appears
**status:** done
**depends on:** TASK-068
**acceptance:**
- [x] Shared `src/components/sharepoint-link.tsx` (`<OpenIn365 url label? className? />`): external new-tab anchor (`target="_blank" rel="noopener noreferrer"`), renders **nothing** on null/empty url. Server-compatible (no client hooks).
- [x] Pointers confirmed to be browser-openable webUrls (bill `attachmentSharepointUrl`, expense `receiptSharepointUrl`, invoice `taxInvoiceSharepointUrl`, project `sharepointFolderUrl`/`sharepointAdminFolderUrl` — all stored as Graph `webUrl`)
- [x] Wired: invoice detail + master-ledger per-row link use `<OpenIn365>`. Bill detail, expense detail (`ReceiptInline`), and project detail (working + admin folders) **already rendered direct new-tab SharePoint links** — left as-is (they already satisfy the requirement); `<OpenIn365>` stands as the primitive to migrate them to opportunistically.
- [x] Direct link opens straight in SharePoint in a new tab; the inline-preview proxy (`/api/attachments/*`) is retained alongside on the surfaces that had it
- [x] Renders only where the surrounding surface already authorised the record — no new exposure
- [x] Tests: `sharepoint-link.test.ts` — null/empty → null; valid url → anchor with correct href + `target="_blank"` + rel. (Required `esbuild: { jsx: 'automatic' }` in `vitest.config.ts` to match Next's JSX runtime.)
- [ ] Commit: `feat(TASK-069d): direct Open-in-365 links` — batched with the ledger series


### TASK-069e — Unified payments register (view + review/edit all inbound & outbound)
**status:** done
**depends on:** TASK-069
**acceptance:**
- [x] Dedicated `/payments` surface listing all inbound + outbound items in one place — receivables (invoices), payables (bills), reimbursables (expenses) — via `buildLedger` restricted to the three editable source types (`src/server/reports/payments.ts` `EDITABLE_SOURCE_TYPES`). Replaces hopping between `/receivables`, `/payables`, `/reimbursables`.
- [x] Each row is **reviewable + editable** via drill-through (`paymentEditHref` → `/invoices/[id]` · `/bills/[id]` · `/expenses/[id]`), which already enforce per-record permission + audit. No inline edit (keeps the audit trail on the canonical surfaces).
- [x] Payment-status lens (`paymentState` / `filterByPaymentState`): All / Outstanding / Overdue / Paid chips with live counts, composable with the direction / type / date filters (shared `parseLedgerFilters`).
- [x] Server-side gate: `report.ledger.view` (super_admin / admin — the intersection audience of the three underlying surfaces; the register is PII-adjacent). No new capability.
- [x] Empty / loading (`loading.tsx`) / error (`error.tsx`) states; "Payments" nav entry in the Reports group.
- [x] Tests: `payments.test.ts` (payment-state classification, status filter, edit-href routing, param parsing). Gate covered by `buildLedger`'s capability check (069) + the page's `hasCapability` guard.
- [ ] Commit: `feat(TASK-069e): unified payments register` — batched

**context:** Raised by TT 2026-07-31 — "ensure we can see all historical inbound and outbound payments submitted and edit/review individual details as required; right now it's divided between receivables, payables and reimbursables." The master ledger (TASK-069) unifies everything read-only; this is the operational review/edit layer on top, consolidating the three split surfaces into one entry point.

**DECISIONS (TT said "go" → built with recommended defaults):** (a) **scope** — the three editable operational item types (invoice/bill/expense) with their payment status, not the full audit ledger (bank-feed / payroll / contractor rows stay in the Master ledger); (b) **edit model** — drill-through to existing per-record surfaces; (c) **home** — a dedicated `/payments` surface (operational tool, distinct from the audit ledger) rather than overloading the ledger tab. `/payments` reuses `buildLedger` for data, so there's no parallel aggregation.

### TASK-069f — Nightly backup skip-gate (export only when changed) + resolver caching
**status:** done
**depends on:** TASK-069c, TASK-061
**acceptance:**
- [x] Skip-gate: the nightly `data-export` cron regenerates nothing when no data changed since the last successful backup (`src/server/exports/backup-gate.ts` — `evaluateBackupGate`). Uses the audit log as the change feed (A9): finds the last `*_generated` backup event, counts mutation events since (excluding backup/export/read actions + its own skip marker). Zero → early-return + `nightly_export_skipped` audit. First-ever run (no prior backup) always runs.
- [x] On-demand triggers (admin buttons, ledger-tab button) are **never** gated — an explicit click always regenerates.
- [x] SharePoint site/drive resolution cached per process with a 10-min TTL (`src/server/integrations/sharepoint-graph.ts` — `resolveSiteAndDrive`), so the ~9 nightly uploads resolve site+drive once (~2 Graph calls) instead of ~18. `excel-workbook.ts` (ledger + 7 workbooks) and `sharepoint-backup.ts` (continuity ZIP) migrated to it; their private resolvers removed (first step of the standing TASK-042c dedup).
- [x] Tests: `backup-gate.test.ts` (run/skip decision + exclusion set); `sharepoint-graph.test.ts` (cache hit + clear).
- [x] Also broadened `/admin/exports` recent-runs to show workbook/ledger backups (landed with TASK-067) so a skipped night is visible by the absence of new rows + the `nightly_export_skipped` marker.
- [ ] Commit: `perf(TASK-069f): skip nightly backup when unchanged + cache site/drive` — batched

**context:** Raised by TT 2026-07-31 — asked whether the 24h regeneration is intensive and whether to export only when new data landed. Assessment: not compute-intensive at firm scale; the cost is Graph latency (site/drive re-resolved per upload). So: added the change-gate (cheap, avoids quiet-day churn) + the resolver cache (the bigger latency win). Deliberately a single global gate, not per-workbook change detection — the granular version is real complexity for negligible payoff at this scale.

---

## Phase 2 — Firm intelligence

> **Deferred from MVP (scope cut confirmed 2026-04-19).** MVP = Phases 0 + 1 only, for parallel-run testing from 2026-04-24. Phase 2 tasks remain fully specified below and should be picked up once the MVP is in TT/JN's hands and steady-state. The ralph loop should not enter Phase 2 automatically — user will flip individual statuses back to `todo` when ready.

### TASK-070 — Firm dashboard (Super Admin / Partner views)
**status:** done
**depends on:** TASK-048, TASK-053
**acceptance:**
- [ ] `/dashboard`: KPIs + section grid (cash, AR aging, utilisation, partner pool, BD pipeline, milestones due)
- [ ] Section layout persisted per user in `UserPreference`

**note (verified 2026-07-31, built ahead of the deferred plan):** `/dashboard` (routed at `/`) — KPI section grid + per-person layout persistence via `dashboard-sections` / `layout-actions.ts` (move/collapse/hide).
### TASK-071 — P&L overview
**status:** done
**depends on:** TASK-055, TASK-044, TASK-046
**acceptance:**
- [ ] `/pnl`: revenue / cost / margin by month
- [ ] Waterfall chart for selected period
- [ ] Drill-down to project

**note (verified 2026-07-31, built ahead of the deferred plan):** `/pnl` — revenue/cost/margin by month, firm `WaterfallChart`, scope tabs + project drill-down.
### TASK-072a — Forecast sandbox: foundation (toggle/adjust + save scenarios)
**status:** done
**depends on:** TASK-071
**acceptance:**
- [x] `Scenario` model + migration `20260731100000_add_scenario` (name, ownerId, note, `adjustments` JSON, timestamps) — **apply manually to prod** (`prisma migrate deploy`)
- [x] `/forecast` sandbox: editable overlay over active projects — toggle each in/out + override contract value; baseline / scenario / delta recompute **live** (client) and authoritatively on the server (`src/server/reports/forecast.ts` `applyForecast`, pure + tested). Never mutates real project data.
- [x] Save / update / delete named scenarios (owner-scoped; super_admin override); scenarios list with per-scenario projected total + delta + load link. Zod-validated adjustments, audit on every write.
- [x] Gated on `hasAnyRole(['super_admin','admin','partner'])` (P&L planner audience); empty/loading/error states; "Forecast" nav entry in Reports.
- [x] Tests: `forecast.test.ts` (include/exclude, value override, unknown-id ignore, defensive `parseAdjustments`).
- [ ] Commit: `feat(TASK-072a): forecast sandbox foundation` — batched

**note on completion:** split from TASK-072 — this delivers the working sandbox (include/exclude + contract-value what-ifs, saved scenarios). The richer edit dimensions (date-shift re-phasing, rate change, hypothetical new projects) are TASK-072b. Projection is contract-value based for now (the firm's book of business); wiring it through `computeFirmPnL`'s revenue/margin model is part of 072b. Full suite green (523).

### TASK-072b — Forecast sandbox: richer what-ifs (dates / rates / hypothetical projects)
**status:** todo
**depends on:** TASK-072a
**acceptance:**
- [x] Baseline-vs-scenario comparison on **revenue + margin** (not only contract value) — `loadBaselineProjects` folds each project's `computeFirmPnL` revenue/margin into the sandbox; `applyForecast` projects contract / revenue / margin (include-exclude drives revenue+margin; a contract-value override only moves the contract metric — it can't retroactively change booked revenue). Editor shows a Contract / Revenue / Margin × baseline/scenario/delta summary that recomputes live. Tested.
- [ ] Shift project start dates in a scenario → re-phase the monthly projection (needs `computeFirmPnL` to accept per-project overrides, or a projection that models phasing)
- [ ] Change rates → project revenue/margin under the scenario from adjusted rates (not just current actuals)
- [x] Add hypothetical (not-yet-real) projects to a scenario without creating real `Project` rows — `Scenario.hypotheticals` JSON (`[{id,name,contractValueCents,marginPct}]`), modelled scenario-only in `applyForecast` (full contract as contract+revenue, contract×margin% as margin); editor "Add hypothetical" section recomputes totals live; Zod-validated + persisted. The unapplied `20260731100000_add_scenario` migration was extended in place to add the column.
- [ ] Tests + commit: `feat(TASK-072b): richer forecast what-ifs`

**progress (2026-07-31):** revenue/margin projection + hypothetical projects landed. Remaining: date-shift re-phasing + rate-change revenue — both need a per-project monthly-phasing / rate-driven projection engine (a larger build than the current static-actuals model).

**context:** carved out of the original TASK-072 so the sandbox could ship a complete first slice (TASK-072a). The revenue+margin projection landed (2026-07-31); the remaining three edit dimensions each need a projection model richer than static actuals (per-project phasing / rate overrides / hypothetical rows), so they stay grouped here.

### TASK-073 — Cost planning + OPEX
**status:** deferred
**depends on:** TASK-071
**acceptance:**
- [ ] `/costplan`: OPEX lines with category, vendor, amount monthly, start/end
- [ ] Drawer to edit
- [ ] Rolls into P&L


**AUDIT (2026-07-31):** likely **largely covered / superseded** — the app already has an `OpexLine` + `FyBudgetOpexLine` model and `/admin/opex` (FY-budget planned-vs-actual OPEX tracker by ATO category), plus `/budget-watch`, `/cashflow`, `fy-budget`. A separate editable `/costplan` risks duplicating that. **Do not build until TT confirms** what `/costplan` would add beyond the existing OPEX/FY-budget surfaces (e.g. per-line vendor + monthly phasing + roll-into-forecast). Left `deferred`.
### TASK-074 — BD pipeline
**status:** done
**depends on:** TASK-009
**acceptance:**
- [ ] `/bd`: kanban by stage (lead / qualifying / proposal / negotiation / won / lost)
- [ ] Deal drawer: value, probability, owner, target close, notes
- [ ] Weighted value rolls up per stage

**note (verified 2026-07-31, built ahead of the deferred plan):** `/bd` — stage kanban (lead→won/lost), deal drawer, weighted-value rollup.
### TASK-075 — Deal → Project conversion
**status:** done
**depends on:** TASK-074, TASK-030
**acceptance:**
- [ ] "Convert" action on won deal → prefills New Project wizard
- [ ] `converted_project_id` stored on Deal; can't be undone

**note (verified 2026-07-31, built ahead of the deferred plan):** `Deal.convertedProjectId @unique`, explicit convert action on the deal detail page, New Project wizard prefill from the deal.
### TASK-076 — Resource planning
**status:** done
**depends on:** TASK-035
**acceptance:**
- [ ] `/resource`: matrix of people × weeks, cells = allocation %
- [ ] Overallocation flagged red
- [ ] Drag-to-adjust (phase 2 polish; initial = click-to-edit drawer)

**note (verified 2026-07-31, built ahead of the deferred plan):** `/resource-planning` — people×weeks bandwidth heatmap, overallocation flagged, click-to-edit (spec’s `/resource` shipped as `/resource-planning`).
### TASK-077 — Partner true-up
**status:** deferred
**depends on:** TASK-071
**acceptance:**
- [ ] `/trueup`: period picker, pool computation (revenue × partner-share rules)
- [ ] Payout rows per partner
- [ ] Approve → generates bill entries for each partner


**BLOCKER / OPEN DECISION (2026-07-31):** the true-up **pool formula is underspecified**. The data exists (`ProjectPartnerContribution` per project + `computePartnerScoreboard` contribution-weighted value), but "revenue × partner-share rules" needs TT to define: what forms the distributable pool (gross profit? net of OPEX? a fixed %?), the per-partner share rule (contribution-weighted? seniority tiers? fixed splits?), and the period basis. Not guessing a partner-compensation formula. Needs a spec before build; left `deferred`.
### TASK-078 — Manager dashboard + Staff "My week"
**status:** deferred
**depends on:** TASK-041
**acceptance:**
- [ ] `/mgrhome`: team utilisation, project health cards
- [ ] `/myweek`: personal utilisation, gaps highlighted


**AUDIT (2026-07-31):** **largely covered** by the role-adaptive root dashboard (`/`) — it already branches staff vs leader (`staff-action-strip.tsx` / `leader-action-strip.tsx` where LeaderRole = manager|partner|admin), with per-person section layout persistence. Dedicated `/mgrhome` + `/myweek` routes don't exist, but their content (team utilisation / project health for managers; personal utilisation / gaps for staff) is served on `/`. **Confirm with TT** whether standalone routes add enough over the adaptive dashboard before building. Left `deferred`.
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
**status:** todo (built once, reverted from main pending staging verification)
**depends on:** TASK-128
**note (2026-07-04):** Was built (confirm intent, `handleConfirm`, `applyTimesheetConfirm`/`applyExpenseConfirm`, `findLatestOutstandingDispatch`, `extractPrefillTokenFromUrl`, reminder-copy CONFIRM line) and briefly reached `main` when a concurrent session's `git add -A` swept it into `ca34c97`. **Reverted from main (2026-07-04, commit-below)** at TT's request because it writes financial/timesheet data headlessly and hadn't been runtime-verified — hold until it can be checked against a live/staging DB. The full implementation is recoverable from git history (`ca34c97` for the code; the reverted diff below). When rebuilding: it needs a **staging-DB smoke test** (send `log 3h on CAC001 today` → link → reply `CONFIRM` → entry shows *submitted* in /timesheet/approve; second `CONFIRM` → "nothing to confirm") before it goes to prod, and should ship as its own reviewable PR (not swept to main).
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

### TASK-199 — PII-at-rest: encrypt self-service bank details (+ remaining gaps)
**status:** done
**depends on:** —
**acceptance:**
- [x] **Fixed the regression:** the self-service `/me` bank form wrote `bankBsb`/`bankAcc` in **plaintext** while the admin path encrypts and payroll `decryptText`s them — a PII-at-rest violation that also broke pay runs (decrypt throws on plaintext). `me/actions.ts` now encrypts BSB + account on write (mirrors `directory/people/[id]/bank/actions.ts`); `me/page.tsx` decrypts them for the owner's own prefill.
- [x] Migration-safe read: new `tryDecryptText` (`src/server/crypto.ts`) passes any legacy plaintext row through unchanged so the transition window doesn't lose values; payroll already surfaces a clear "re-enter" error on a hard decrypt failure. Verified `payruns.ts` only uses the encrypted `supplierBsb` as a truthy presence check (not a payout) — not a second bug.
- [x] Tests: `crypto.test.ts` (envelope round-trip + `tryDecryptText` legacy fallback), `me-bank-encryption.test.ts` (action stores ciphertext that decrypts back; blanks store null).
- [ ] Commit: `fix(TASK-199): encrypt self-service bank details at rest`

**REMAINING PII GAPS:**
- [x] `bankSwift` / `bankIban` now encrypted at rest — only the `/me` form writes them (there is no admin SWIFT/IBAN path), so `me/actions.ts` `encryptText`s on write and `me/page.tsx` `tryDecryptText`s for the owner's prefill. Test extended (`me-bank-encryption.test.ts` GB/IBAN case).
- [ ] `taxFileNumber` / `superFundId` — schema columns marked `// encrypted` but **no write path exists anywhere** (no form captures them). Nothing to fix now; when a capture UI is added it MUST `encryptText` on write. (N/A until then.)
- [ ] Optional uniformity: migrate `directory/people/[id]/bank/page.tsx` display (already try/catch-safe) + `payruns.ts` presence-read to `tryDecryptText`.

**context:** Found during the 2026-08-03 operational-readiness audit (TT asked "what else for this to be operational"). The plaintext-bank write was the one true go-live blocker in the security must-haves; fixed here. The remaining items are pre-existing broader PII-hardening gaps, not the regression.

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

### TASK-221 — Timesheet approval loop: clear the queue, flag the submitter, WhatsApp both ends
**status:** done
**depends on:** —
**acceptance:**
- [x] **Root cause of "I approved it but it still hangs around":** `decideTimesheetEntries` loaded the batch with `status: 'submitted'` in the `where` and then bailed with `Some entries already decided or missing.` unless *every* requested id matched. One stale id in the card (recalled by the submitter, decided in another tab, or auto-approved from the person's own sheet) failed the whole decision, so nothing moved and the card stayed put. Now partitions the batch (`partitionDecisionBatch` in `src/server/timesheet.ts`), decides what it can, and reports what it skipped.
- [x] An all-stale batch returns **success** ("Already decided — actioned elsewhere. Queue refreshed.") and still revalidates, instead of an error that left the row on screen.
- [x] **Stale-surface fix:** the decision only revalidated `/timesheet/approve`. Added `/updates` + `revalidateScheduleSurfaces({ personId })` per affected submitter, so the dashboard leader-action strip ("N timesheet entries to approve"), the submitter's `/timesheet`, utilisation, resource planning, and the person profile all move on approval. This was the second half of the "hangs around" report — the dashboard card was counting rows that had already been approved.
- [x] **Flags back to the submitter:** the feed item now names the approver and the hours (`Approved by TT · 5 entries · 38.0h now posted to project P&L`), and a send-back carries the approver's reason as `Reason: …`. New decision banner at the top of `/timesheet` (green on approve, red on send-back, 14-day window, "new" pill while unread) so the outcome lands on the timesheet itself, not only in `/updates`.
- [x] **Submission was silent — approvers now get told.** `saveTimesheet` tracks what actually lands as `submitted` (auto-approved and locked rows excluded) and, inside the same transaction, writes an `approval_requested` UserUpdate to the admin pool + each affected project's manager / primary partner (never the submitter or the actor).
- [x] **WhatsApp, both directions** (`sendTimesheetApprovalQueueNotice`, `sendTimesheetDecisionNotice` in `whatsapp-prompts.ts`): approvers get "Rachael submitted 5 entries · 38.0h, week of 17/08/2026" on submit; submitters get "your timesheet has been approved by …" (or the send-back reason) on decision. Both reuse the module's `send()` so every outbound is logged to `WhatsAppMessage` and deduped 18h on identical body. Fired after commit, never awaited, wrapped in try/catch — a Meta outage cannot fail an approval.
- [x] Tests: `timesheet-approval-loop.test.ts` — 10 cases over `partitionDecisionBatch` (including the stale-id regression) and both WhatsApp message builders.
- [x] Typecheck + lint + 546 tests green.
- [ ] Commit: `fix(TASK-221): timesheet approvals clear the queue + notify both ends`

**OPEN — needs TT:** the WhatsApp notices go out as **free-form text**, like every other outbound in the app today. Meta only delivers free-form outside a 24-hour window if the recipient messaged the bot recently; otherwise the send fails with a re-engagement error (logged on `WhatsAppMessage.errorMessage`, no user-visible failure). Making these reliable needs two approved message templates (`timesheet_awaiting_approval`, `timesheet_decision`) added to the WABA template set. Tracked against the outstanding WhatsApp go-live gates.

**context:** TT-reported, 2026-08-21. Three asks in one: the queue not clearing, the submitter not knowing, and WhatsApp on both ends.

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

**Out of scope (moved to TASK-302f):** CSV → bulk timesheet / personnel / bills / expenses attachment. Original binary upload to SharePoint. Multi-file per message. Word doc / Excel parsing.

### TASK-302f — Admin drag-drop CSV → bulk-import preview (this task)
**status:** doing
**depends on:** TASK-302e
**framing:** JN + TT (admins) upload timesheet / personnel / bill / expense CSVs from `/admin/import/*` today. They asked for the same fast-path via the assistant — drop a CSV onto the assistant panel, land straight on the dry-run preview with the file already parsed. Zero-click bulk-import launch. Non-admins can't drop CSVs (existing PDF/image path only).

**acceptance:**
- [x] Client MIME allowlist extended to include `text/csv`, `application/vnd.ms-excel`, and files with a `.csv` extension so drag-drop from Excel/Finder/Numbers all work.
- [x] Server-side kind detection by inspecting header row — timesheets (`hours`), personnel (`firstName`+`band`), bills (`supplierName`+`supplierInvoiceNumber`), expenses (`personEmail`+`amountTotalDollars` without `hours`). Non-CSV files still route through the receipt OCR path.
- [x] For each detected kind, the assistant runs the existing pure `buildXPreview` parser + `stashX` — same code path the admin surface uses. Returns a `prefill_card` pointing to `/admin/import/{kind}?stage=preview&token=<opaqueToken>`. From the user's perspective: they land on the preview screen with counts + rejections rendered and the Commit button live.
- [x] Per-kind capability gate. Detected kind requires the caller to hold the corresponding capability (`timesheet.approve`, `person.create`, `bill.create`, `expense.approve.under_2k`). Missing cap → tool returns `permission_denied` with a friendly message; admins pass through.
- [x] Attachment chip in the user bubble flips uploading → parsing → "✓ timesheet CSV · 48 rows · 3 rejected" (or the equivalent per kind).
- [x] Nothing writes to the DB from the assistant path — the Commit button on the admin preview page remains the sole write action, using the same server action the direct-upload path uses.
- [x] Tests: kind detection covers each header shape + malformed inputs.
- [x] Typecheck + lint green.
- [ ] Commit: `feat(TASK-302f): admin drag-drop CSV → bulk-import preview`.
- [ ] Smoke: JN drags a real timesheet CSV onto the assistant → chip flips to "48 rows · 3 rejected" → prefill card renders → click → land on `/admin/import/timesheets?stage=preview&token=…` with the preview live. Click Commit → rows land in `TimesheetEntry` per the existing bulk-import audit trail.

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

### TASK-304 — Personnel bulk import: optional personal email + non-destructive updates
**status:** doing
**framing:** JN's full-team FY26 personnel CSV bounced on upload: the importer rejects any *new* contractor without a `personalEmail`, and the file has that column blank for all 35 people (34 are contractors) — 34/35 rows errored and the all-or-nothing commit was blocked. `personalEmail` has no code consumers (grep confirms) and is not used for auth — magic-link login keys on the `@foundry.health` work email (auth.ts `REQUIRED_EMAIL_SUFFIX`). It's a payroll/contracts contact placeholder only. TT decision (2026-07-24): (1) don't require it on bulk import — align it with the foundry work email for each account; (2) on *update*, never overwrite an existing value with a blank CSV cell.

- [x] Importer no longer errors on a new contractor with a blank `personalEmail`. Blank `personalEmail` on a **new** row defaults to the person's own `@foundry.health` work email at commit.
- [x] `personalEmail` may equal the person's own work email; an explicitly-provided *different* `@foundry.health` address is still rejected (guards against pasting the wrong mailbox).
- [x] On **update**, a blank CSV cell leaves the existing DB value untouched (rate, fte, roles, phone, whatsappNumber, personalEmail, linkedinUrl). The `ft`-needs-`fte` rule now applies to **new** rows only. Preview diff reflects the skip (no phantom rate→$0 rows).
- [x] Tests: new-contractor-blank-personalEmail passes; update-with-blank-fields yields an empty diff; own-work-email allowed / other-foundry-address rejected. Full suite green.
- [ ] Commit: `feat(TASK-304): personnel import — optional personal email + non-destructive updates`.
- [ ] Hand-off: JN (or TT) re-uploads the same CSV at /admin/import/personnel → preview shows 0 errors → Commit. (Checkout can't reach prod DB; the platform is the authoritative write path per A1 + writes the A9 audit event.)

---

## Phase 7 — FY27 role architecture (personnel taxonomy)

Migrate personnel fields, functionality and taxonomy to the FY27 role architecture. **Shared reference: [`FY27_ROLE_ARCHITECTURE.md`](FY27_ROLE_ARCHITECTURE.md)** (crosswalk + decisions) and the source package in [`docs/fy27-migration/`](docs/fy27-migration/). Decisions locked by TT 2026-07-28: **hybrid** data model (flat `Person` current-state + effective-dated dimension tables + FY27 reference tables), **phased MVP** for go-live, **new `OPERATIONS`/`OM`** band+code for the Office Manager, **adopt FY27 rate bands**. Do NOT run the four `.sql` files against the Prisma DB — they are the spec, ported into Prisma migrations by these tasks. Schema is `2.3-draft`, `PENDING_MP_SIGNOFF` — nothing in this phase runs against **prod** until the MP signs off and OD-1 is resolved.

### TASK-400 — FY27 taxonomy constants + legacy crosswalk (code, no DB)
**status:** done
**depends on:** —
**acceptance:**
- [x] New `src/lib/fy27-roles.ts`: the 17 canonical role codes + `OM`, 8 bands + `OPERATIONS`, engagement types (`permanent`/`contractor`/`program`/`honorary`), workforce statuses (`ACTIVE`/`RESERVE`/`ALUMNI`/`ADVISOR`), pool codes, and per-role metadata (title, band, seniority_rank, permits_*, incentive target) — sourced from `docs/fy27-migration/foundry_roles_schema.json` via `scripts/gen-fy27-roles.mjs` → `src/lib/fy27-roles.generated.ts`, not re-keyed by hand.
- [x] `legacyLevelToRoleCode(level)` implementing the §3a crosswalk (incl. `L4→P1`, `IO→I0`, `OM→OM`) and `bandForRoleCode(code)`; `isLeadershipRoleCode` / `isLeadershipBandCode` predicates that correctly include L1/L2/L3 under LEADERSHIP. Also `poolForRoleCode`, `titleForRoleCode`, `roleMeta`, `ROLE_CODES`.
- [x] Pure unit tests covering every current level code → expected (role code, band), the two renames, and the OM/OPERATIONS extension (27 tests).
- [x] `pnpm typecheck && pnpm lint` green; the 27 new tests pass. (Full suite: 405 pass, 1 **pre-existing** unrelated failure in `assistant-tools.test.ts` from commit `ce5ccb5` — flagged separately, not introduced here.)
- [x] Commit: `feat(TASK-400): FY27 taxonomy constants + legacy crosswalk`.

**context:** Foundation for the rest of Phase 7 — every later task imports from here. No schema change yet, so it can land and be reviewed independently.

**note on completion:** Generated data (`fy27-roles.generated.ts`) is produced from the canonical schema JSON so the app taxonomy, the SQL seed, and the PDs can't drift. `EngagementType`/`EmploymentBasis`/`WorkforceStatusCode`/`PoolCode` types exported for the downstream tasks. Leadership predicate deliberately now includes L1/L2 (band move) — consumers still read the legacy `isLeadershipBand` until TASK-408 rewires them.

### TASK-401 — FY27 reference tables: schema + seed (bands, roles, rate bands, statuses, pools, code map)
**status:** todo
**depends on:** TASK-400
**acceptance:**
- [ ] Prisma models for the reference data (port of package file 01 §1 + seed file 02): `RefBand`, `RefRole`, `RefRateBand` (geo + cost anchor + basis; **no stored bill rate**), `RefBillingMultiple`, `RefWorkforceStatus`, `RefTalentPool`, `RefPoolRole`, `RefPromotionStep`, `RefCredentialType`, `RefRoleCodeMap`. Effective-dated (`effectiveFrom`, `schemaVersion`); current-state read via a documented "latest ≤ today" query helper.
- [ ] `chore(db):` migration committed separately from the seed wiring (per CLAUDE.md rule 9).
- [ ] Seed populated from `docs/fy27-migration/foundry_roles_schema.json` (regenerate via `generate_seed.py` or a TS equivalent — do not hand-key). `SELECT count` parity: 18 roles, 9 bands, incl. `OM`/`OPERATIONS` as `not_time_billed`.
- [ ] Bill rate is **derived** in a helper (cost ×2 / ×3 from `RefBillingMultiple`), never stored — mirror of `v_rate_card_current`.
- [ ] Tests: derived bill matches the anchor ×2/×3; `RefRoleCodeMap` resolves every current `Person.level` value (no `requires_review` gaps for real data).
- [ ] Migration is manual against prod (see memory: nothing auto-runs `migrate deploy`). Commit: `feat(TASK-401): FY27 reference taxonomy tables + seed`.

**context:** Adopts D4 (FY27 rate bands, geo, derived bill). Reference tables are seeded and staging-dogfooded before any `Person` row is touched.

### TASK-402 — Person dimension tables + current-state cache fields (hybrid model)
**status:** todo
**depends on:** TASK-401
**acceptance:**
- [ ] New append-only, effective-dated dimension tables: `PersonRole`, `PersonStatus`, `PersonEngagement`, `PersonRate` (+ `PersonPool`), each with `effectiveFrom`, `changeReason`, `supersedesId`, `approvedBy`, `recordedAt` per package file 01 §3.
- [ ] Append-only enforced **app-side** (no Prisma trigger equivalent): a single write module is the only door; direct update/delete of a domain row is rejected in code + covered by a test. Every write emits an `AuditEvent` in the same transaction (A9).
- [ ] `Person` gains denormalised current-state cache columns: `roleCode`, `engagementType`, `employmentBasis`, `workforceStatus`, `poolCode` (written through by the dimension write module; documented as cache, not source of truth). Extend the `Band` enum with `Leadership`, `Fellow`, `Advisor`, `Intern`, `Operations` (keep existing values for the transition).
- [ ] `chore(db):` migration committed separately from the write module.
- [ ] Tests: an append creates a new row (never mutates); a correction sets `supersedesId`; the cache column matches the latest dimension row; a direct-mutation attempt throws.
- [ ] Commit: `feat(TASK-402): person dimension tables + current-state cache`.

**context:** D1 hybrid. Deliberately does NOT delete `employment`/`level` yet — the transition keeps both readable so the ~44 consumers don't break in one step. Field removal is a later cleanup once all reads move over.

### TASK-403 — Backfill existing people into the FY27 taxonomy + reconciliation
**status:** todo
**depends on:** TASK-402
**acceptance:**
- [ ] Idempotent backfill script (port of package file 03) that, for every `Person`: writes a `PersonRole` (level→role code via TASK-400 crosswalk), `PersonEngagement` (employment→engagement + basis + FTE), `PersonStatus` (active→ACTIVE, archived→ALUMNI; `inactiveAt`→flagged for per-person MP review, NOT auto-Reserve), `PersonPool` (from role code), and — for contractors — a `PersonRate` no-worse-off pass (`grandfathered` / `band_anchor` / `deviation_below` flagged). Populates the `Person` cache columns + remaps `band` (incl. L1/L2→Leadership, F1/F2→Fellow, IO→Intern, OM→Operations).
- [ ] Reconciliation output (port of `v_migration_reconciliation`): headcount by engagement basis + status + pool matches pre-migration counts; zero rows in a ported `v_integrity_exceptions` check.
- [ ] Runs clean against a **seeded staging copy** first; a dry-run mode prints the diff without writing.
- [ ] Prod cutover gated on: (a) MP schema sign-off, and (b) the per-person `inactiveAt`→status reviews being actioned. **OD-1 is resolved — preserve-and-flag (no auto-uplift):** below-anchor contractors keep their current rate recorded as `deviation_below` and flagged; do NOT lift anyone to anchor.
- [ ] Commit: `feat(TASK-403): backfill existing people into FY27 taxonomy`.

**context:** `Person.level` is a free string so nothing auto-migrates — this is the one-time data pass. Follows the brief's rule that Reserve is never assumed on someone's behalf. OD-1 resolved by TT 2026-07-28 (preserve-and-flag); the flagged classification must surface on the resourcing tab — see TASK-410.

### TASK-404 — Person create/edit form + actions on the new taxonomy
**status:** todo
**depends on:** TASK-402
**acceptance:**
- [ ] `directory/people/new/{form,actions}.tsx` and `directory/people/[id]/edit/{form,actions}.tsx` use role-code pickers grouped by band (from TASK-400/401), engagement type + basis + FTE (with the permanent⇒FTE / contractor⇒no-FTE constraints), and a workforce-status control. Writes go through the TASK-402 dimension write module (effective-dated), not a direct `Person` update.
- [ ] Rate auto-snap works against the FY27 anchor for the selected role code + geo; off-anchor entry sets `rateBasis` + requires a `deviationReason` and records `approvedBy` (MP gate for non-anchor).
- [ ] Empty / loading / error states present (CLAUDE.md). Server-side capability check + Zod validation on every mutation.
- [ ] Tests for the new actions (append-only write, constraint rejection, off-anchor requires reason). Commit: `feat(TASK-404): person edit on FY27 taxonomy`.

### TASK-405 — Directory + profile surfaces on the new taxonomy
**status:** todo
**depends on:** TASK-404
**acceptance:**
- [ ] Directory roster + profile page render role-code labels + band groupings from the reference tables; filters cover band / engagement type / workforce status / pool. Status chips show ACTIVE/RESERVE/ALUMNI/ADVISOR (reconciled with the existing `inactiveAt`/`endDate`/`poolStatusOverride` display — no double-encoding).
- [ ] `labelForLevel` / `FOUNDRY_LEVELS` consumers updated or shimmed to the new source; no raw codes leak into the UI.
- [ ] Empty / loading / error states. Commit: `feat(TASK-405): directory + profile on FY27 taxonomy`.

### TASK-406 — CSV import + template + tests on the new taxonomy
**status:** todo
**depends on:** TASK-402
**acceptance:**
- [ ] `src/server/imports/personnel.ts` accepts `roleCode` (or a legacy label resolved via `RefRoleCodeMap`), `engagementType`, `employmentBasis`, `geo`, `workforceStatus`, `pool`; validators sourced from TASK-400 (no hardcoded `BANDS`/`EMPLOYMENTS` arrays). Commit writes through the dimension write module.
- [ ] `public/templates/personnel-template.csv` + `admin/import/personnel/page.tsx` help text updated to the new columns. Pre-existing `region` bug fixed (importer no longer narrower than `Person.region`).
- [ ] Golden tests in `src/__tests__/import-personnel.test.ts` updated: legacy-label rows resolve; ambiguous labels (`Consultant (0.5 FTE)`) surface for review rather than guessing; append-only write verified.
- [ ] Preserve TASK-304 behaviours (optional personal email, non-destructive blank-cell updates). Commit: `feat(TASK-406): personnel import on FY27 taxonomy`.

### TASK-407 — Rate card: cost-anchor + derived bill + geo + person deviation log
**status:** todo
**depends on:** TASK-401
**acceptance:**
- [ ] `src/server/rate-card.ts` + `admin/rate-card/*` read the FY27 `RefRateBand` (cost anchor per role code + geo); bill columns are **derived** ×2/×3, never stored. Display bands come from the reference table, not the hardcoded `ROLE_LABELS`/`ORDER` maps.
- [ ] Person-level deviation log surfaced (a ported `v_rate_transition_check`): above-anchor = grandfathered, below-anchor = flagged for MP review, off-anchor requires MP `approvedBy` + reason.
- [ ] No-worse-off assertion available as a check (port of integrity rule 5). Tests: derived bill = anchor ×2/×3; deviation without MP approval rejected. Commit: `feat(TASK-407): FY27 rate bands + deviation log`.

### TASK-408 — Generalise band/leadership consumers + wire integrity checks into CI
**status:** todo
**depends on:** TASK-402
**acceptance:**
- [ ] `isLeadershipBand` and every hardcoded off-pyramid band check (availability, resource-planning, utilisation, manager-dashboard, availability/edit pages — see `FY27_ROLE_ARCHITECTURE.md` §4) driven by the reference taxonomy so L1/L2 count as leadership and FELLOW/ADVISOR/INTERN/OPERATIONS are correctly excluded from capacity/utilisation.
- [ ] The ported `v_integrity_exceptions` checks (engagement-not-permitted-for-role, advisor/status mismatch, permanent-without-FTE, intern-nonzero-rate, person-without-status, etc.) run as a zero-row assertion in CI (package migration step M9).
- [ ] Tests cover L1/L2 leadership classification + an off-pyramid exclusion. Commit: `feat(TASK-408): generalise band consumers + integrity CI gate`.

### TASK-410 — Surface the below-anchor rate classification on the resourcing tab
**status:** todo
**depends on:** TASK-407
**acceptance:**
- [ ] `/resource-planning` (`src/app/(app)/resource-planning/page.tsx` + `pool-chip.tsx`) shows a distinct badge/pip on a person's `PoolChip` when their current `person_rate` is `deviation_below` (below the FY27 anchor, flagged for MP review). Visually separate from the existing engagement-status colour pip and the ⊕ override glyph so the two don't collide. Optionally distinguish `grandfathered` (above-anchor) with its own subtle marker.
- [ ] A filter and/or a header summary count ("N below anchor") so a partner scanning the resourcing tab can immediately see who has moved into the flagged classification, and jump to them.
- [ ] Hovering/opening the badge shows the specifics: current cost vs band anchor, geo, and the deviation reason (from the TASK-407 deviation log / `v_rate_transition_check` port). Reads only — no rate edits from this surface (rate changes stay MP-gated in TASK-404/407).
- [ ] Server query scoped by capability (rate data is sensitive — reuse the `ratecard.view` / resource-planning capability gate, don't expose cost to roles that can't already see it). Empty/loading/error states present.
- [ ] Tests: a `deviation_below` person renders the badge + counts in the summary; a `band_anchor` person does not; the badge is hidden for roles without the capability.
- [ ] Commit: `feat(TASK-410): below-anchor rate flag on resourcing tab`.

**context:** TT (2026-07-28), on resolving OD-1 to preserve-and-flag: "Ensure that this is visible in the resourcing tab so we can see when people have moved into that classification." The classification data is produced by the TASK-403 backfill (`person_rate.rate_basis = 'deviation_below'`) and the TASK-407 deviation log; this task is purely the resourcing-tab surfacing of it. Reconcile with the `poolStatusOverride` / status pip decision noted in `FY27_ROLE_ARCHITECTURE.md` §6 so pips aren't double-encoded.

### TASK-409 — Seed + fixtures on the new taxonomy
**status:** todo
**depends on:** TASK-401, TASK-402
**acceptance:**
- [ ] `prisma/seed.ts` (`mapBand`, `mapEmployment`, `rolesForPerson`, `seedRateCard`) + `prisma/fixtures/*.json` emit FY27 role codes / bands / engagement / status / pool via TASK-400, and seed the reference tables via TASK-401. Staging seed still runs clean end to end.
- [ ] Access `Role` enum assignment stays a separate axis from role code (documented). Commit: `feat(TASK-409): seed + fixtures on FY27 taxonomy`.

---

*Deferred to post-go-live (D2). Do not auto-pick in the ralph loop.*

### TASK-420 — Promotion tenure clock + eligibility surfaces
**status:** deferred
**depends on:** TASK-402
**acceptance:** Port `v_role_tenure` (active-days only; Reserve pauses, never resets — keep the Alumni/Reserve NULL-guard), `v_promotion_eligibility` (machine gates only; contribution/sponsorship/business-need surfaced as human decisions), and `v_tenure_watchlist`. As Prisma queries/views over the dimension tables.

### TASK-421 — Understudy assignments
**status:** deferred
**depends on:** TASK-420
**acceptance:** `UnderstudyAssignment` table + surface; feeds the L-band promotion gate (`gate4_understudy_complete`).

### TASK-422 — Incentive framework
**status:** deferred
**depends on:** TASK-402
**acceptance:** `IncentiveAward` (standardised dimensions, discretionary amount, target by band); contractors excluded (integrity rule 3). Rem-Committee approval path.

### TASK-423 — Credential modifiers + supervision overlay
**status:** deferred
**depends on:** TASK-402
**acceptance:** `PersonCredential` + `RefCredentialType`; provisional AHPRA triggers a supervision overlay; credentials position rate within band, never change the role code.

### TASK-424 — Reserve review + re-entry surfaces
**status:** deferred
**depends on:** TASK-403
**acceptance:** Port `v_reserve_review` (quarterly pool-lead list + past-24-month flag, OD-3) and the re-entry rules (0–12 / 12–24 / >24-month treatments).

## Phase 8 — Monthly lodgement → batch approval → contractor invoice

> **TT 2026-08-31, designated priority workflow.** Individuals lodge hours **monthly**, the month is approved as a **batch**, and on approval the contractor's invoice to Foundry is **generated for them to confirm**. Must be easy to do individually — self-serve, not admin-driven.
>
> **Decisions locked by TT 2026-08-31:**
> - **D1 — Issuance: contractor confirms a pre-filled draft.** Foundry generates the draft from approved hours; the contractor reviews and hits "Submit invoice", which is their act of issuing. Their invoice number, their document. **This deliberately avoids the AU Recipient Created Tax Invoice (RCTI) regime** — Foundry never issues on the contractor's behalf, so no written RCTI agreement per contractor is required. Any future change to Foundry-issues must re-open that compliance question first.
> - **D2 — Close trigger: all projects approved.** The draft invoice fires only when *every* entry in that person-month is approved, so a contractor spanning three projects gets one invoice, not three. Mitigations for the slow-approver risk are in TASK-506 (chase notice + admin force-close).
>
> **Scope note:** monthly lodgement + batch approval apply to **everyone** who logs time. Invoice generation applies only to `employment: contractor` — full-time staff are paid via pay runs and must never reach the invoice surface.
>
> **Sequencing:** TASK-500 is a live revenue-leak fix that stands alone and should land first regardless of the rest of the phase. TASK-504 must not ship before TASK-500 — turning on auto-generation over today's shared status column would silently destroy the ability to bill those hours to clients.
>
> **Sequencing, resolved 2026-09-01:** TT said "go ahead" then "keep going until you're done", so Phase 8 ran ahead of the remaining Phase 7 tasks. Phase 7 is in any case gated on MP sign-off and OD-1. **All seven tasks are done** — the loop's next `todo` is back to TASK-401.
>
> **PHASE COMPLETE — three manual steps remain before any of this is live:**
> 1. **Run the four migrations against prod.** Nothing auto-runs `prisma migrate deploy`. In order: `20260901000000_timesheet_contractor_bill_link`, `20260901010000_timesheet_period`, `20260901020000_period_invoice_draft`, `20260901030000_period_chase_tracking`.
> 2. **Read the first migration's `RAISE NOTICE` output.** Any row it lists could not be matched to a `bill.created` audit event and needs a human to decide which bill it belonged to. Empty notice = nothing to do.
> 3. **Create the `timesheet_chase` FeatureFlag row and enable it** when you want the chase cron live. Until then `/api/cron/timesheet-chase` returns `{skipped}`. Optionally set `TIMESHEET_CHASE_AFTER_DAYS` / `TIMESHEET_ESCALATE_AFTER_DAYS` (defaults 3 / 7).

**DEPLOYED TO PROD 2026-09-06 — with an incident. Read this before deploying any later phase.**

All four Phase 8 migrations were applied to prod via the Supabase SQL Editor (`scripts/phase8-supabase.sql`: the migration files concatenated in one transaction, with matching `_prisma_migrations` ledger rows). The CLI route was unavailable — `.env.local` points at Supabase ref `epadyqrgutfzvwwxyxjm`, which no longer exists, and Vercel marks `DATABASE_URL`/`DIRECT_URL` as **Secret**, which is write-only, so `vercel env pull` returns `[SENSITIVE]` placeholders. The TASK-500 backfill reported **zero** affected rows, so no hours needed manual reassignment.

**What went wrong:** these migrations were applied from an **unmerged branch** while production still ran `main` (HEAD 2026-07-11). TASK-500's migration *drops* `'billed'` from the `TimesheetStatus` enum, and the deployed July code referenced that literal in 23 files (`status: { in: ['approved','billed'] }`). Every page reading timesheet hours started failing with `invalid input value for enum TimesheetStatus: "billed"` — `/me`, `/directory/people/[id]`, project hours + tracker, `/timesheet/approve`, and the P&L / utilisation / budget / scorecard / Excel-export paths.

**Restored** within minutes by `ALTER TYPE "TimesheetStatus" ADD VALUE IF NOT EXISTS 'billed';` — lossless, since no row has ever held the value post-backfill. Prod's enum is now deliberately ahead of its own migration history; `20260907000000_drop_timesheet_status_billed` closes that gap and **must ship in a deploy AFTER the Phase 8 code is live** (see TASK-508).

**The rule this establishes:** additive migrations may be applied ahead of code; **destructive ones may not**. `scripts/vercel-build.mjs` already auto-applies migrations on production builds — so in the normal flow (merge → deploy) schema and code move together and this cannot happen. It only happened because the migrations were hand-applied out of band. Prefer merging over hand-applying; see TASK-507.

**Also corrected:** three late-July migrations (`add_import_dry_run`, `add_invoice_sharepoint_pointer`, `add_scenario`) were found missing from prod's ledger and backfilled via `scripts/backfill-july-migrations.sql`. This was initially — and wrongly — read as "three features broken in production for six weeks". They were not: that code has never been merged to `main` either, so nothing referenced the missing tables. The backfill was harmless (additive tables + nullable columns) but was not fixing a live fault.

### TASK-500 — Decouple contractor-bill from client-invoice hour consumption
**status:** done
**depends on:** —
**acceptance:**
- [x] **Root cause:** `generateDraftBillFromHours` (`src/app/(app)/directory/people/[id]/draft-bill/actions.ts:156`) sets `TimesheetEntry.status = 'billed'`, while `previewInvoiceFromTimesheets` (`src/server/invoice-drafter.ts:79`) filters `status: 'approved'`. Billing a contractor therefore **permanently and silently** removes those hours from the client-invoice pool. It breaks the other way too: `draft-bill` filters `billedInvoiceId: null`, so client-invoicing first hides the hours from the contractor's own bill. The two legs are economically independent — the same hour is a cost at `Person.rate` and revenue at `Person.billRate` — and must stop competing for one marker.
- [x] `chore(db):` migration adding `TimesheetEntry.contractorBillId String?` + FK to `Bill` (`ON DELETE SET NULL`, mirroring the existing `billedInvoiceId` FK) + index. Separate commit from the wiring, per CLAUDE.md rule 9.
- [x] `generateDraftBillFromHours` stamps `contractorBillId` instead of mutating `status`. Its candidate query (`listContractorBillableEntries`, `src/server/timesheet.ts:279`) filters on `contractorBillId: null`, **not** `billedInvoiceId`.
- [x] `previewInvoiceFromTimesheets` is unchanged in behaviour but now provably unaffected by contractor billing — add a regression test asserting an entry with `contractorBillId` set still appears in the client draft.
- [x] **Backfill:** existing rows at `status='billed'` are contractor-billed hours that were wrongly excluded from client invoicing. Migration resolves each back to `approved` and sets `contractorBillId` from the `timesheetEntryIds` recorded in the `bill.created` audit events (`source: 'timesheet_draft_bill'`). Rows that can't be matched to an audit event are left at `approved` with `contractorBillId` null and **listed in the migration output** for manual review — do not guess.
- [x] Decide + implement `TimesheetStatus.billed`: with both legs on their own FK the enum value has no remaining writer. Either drop it in the same migration or document why it stays. Consumers keying off it must be rewired either way — `grid.tsx:642`, `submitted-overview.tsx:86`, `hours/panel.tsx:85`, `approve/page.tsx:284`, `directory/people/[id]/page.tsx:140`, `me/page.tsx:133`, `projects/[code]/tracker/page.tsx:73`.
- [x] `deleteDraftInvoice` audit event records how many timesheet entries the FK released (`ON DELETE SET NULL` already does the release; today the count is absent from the ledger).
- [x] Tests: contractor-bill-then-client-invoice and client-invoice-then-contractor-bill both bill the same hours exactly once on each leg; backfill resolver against fixture audit events.
- [x] Typecheck + tests + lint green. Migration is **manual against prod** (see memory: nothing auto-runs `migrate deploy`).
- [x] Commits: `chore(db): contractorBillId on TimesheetEntry` then `fix(TASK-500): decouple contractor bill from client invoice hour pool`

**context:** Found tracing the timesheet→invoice chain for TT, 2026-08-31. Pre-existing on `main`, independent of the rest of Phase 8, and a live revenue leak on any contractor whose hours were drafted into a bill. Ships alone.

**note on completion:** Landed as `chore(db): contractorBillId on TimesheetEntry + retire TimesheetStatus.billed` (50574f3) then `fix(TASK-500): decouple contractor bill from client invoice hour pool` (512e1c0). Typecheck clean, `next lint` clean, **563 tests pass across 59 files** (17 new).

**`TimesheetStatus.billed` — decision: dropped.** After both legs moved to their own FK the value had no writer, so the migration releases every `billed` row to `approved` and removes it from the enum. That makes "an hour's AP state is never encoded in its status" an invariant Postgres enforces. `billed` survives only as a **derived display state** (`toDisplayStatus` in `src/server/timesheet.ts`) meaning the **AR leg only** — which is what every surface using the word already claimed ("on invoice", "linked to invoice"). Before this task the label was wrong in the other direction: driven by the contractor-bill flow, it counted hours Foundry had been invoiced FOR, not hours it had invoiced OUT. `isBilledEitherLeg` is the separate, explicitly-named predicate for edit-lock / delete guards. Consumer sweep was wider than the seven files listed above — 13 more carried `status: { in: ['approved', 'billed'] }` across P&L, utilisation, budget, partner scorecard, FY budget and the Excel exports; all collapse to `'approved'` with identical behaviour.

**Two further defects found while wiring this up, both fixed here:**
1. `saveTimesheet`'s super-admin zero-hour delete guard read `existing.status !== 'billed'`, which never covered the AR leg — a super-admin could delete an hour already sitting on a **client invoice**. Now guards on both legs via `isBilledEitherLeg`.
2. `generateDraftBillFromHours` rejected **every** submission that left the (UI-optional) attachment URL blank. The caller normalises blank to `null`; the Zod shape `.optional().or(z.literal(''))` accepted `undefined` and `''` but not `null`, so the action always returned "Invalid bill payload". Pre-existing and independent of this task — but the AP leg could not function at all without it, so it is fixed here rather than deferred.

**Test honesty note:** the AR-side where-clause assertion alone would pass against the old code (the AR query was never the thing that changed) — the real defect was in the **writer**. `contractor-bill-writer.test.ts` pins the write payload and candidate query at that site, and was **verified to fail** when the old `status: 'billed'` write is restored (2 of 5 tests go red). The backfill's SQL JSON path is guarded by a test over the real `computeDelta` output rather than a re-implementation of the resolver, so a change to the audit envelope surfaces as a red test instead of a silently non-matching migration.

**REQUIRES MANUAL PROD STEP:** the migration does not auto-apply. Run `prisma migrate deploy` (or apply `prisma/migrations/20260901000000_timesheet_contractor_bill_link/migration.sql` via the Supabase SQL editor) against prod, and **read the `RAISE NOTICE` output** — any row it lists could not be matched to a `bill.created` audit event and needs a human to decide which bill it belonged to.

### TASK-501 — TimesheetPeriod (person × calendar month) + true calendar-month grid
**status:** done
**depends on:** —
**acceptance:**
- [x] **Root cause:** `getMonthForPerson` (`src/server/timesheet.ts:21`) is `getRangeForPerson(personId, blockStart, 28)` anchored to `startOfFourWeekBlock` — a rolling 28-day block, not a calendar month. It drifts and never aligns to "August", so a contractor cannot select the period they need to invoice for.
- [x] `chore(db):` migration for `TimesheetPeriod`: `personId`, `year`, `month` (1–12), `state` (`open` / `lodged` / `approved` / `invoiced`), `lodgedAt`, `approvedAt`, `invoicedAt`, `contractorBillId?`. `@@unique([personId, year, month])`. Separate commit.
- [x] `getMonthForPerson(personId, year, month)` returns a true calendar month (28–31 days). `startOfFourWeekBlock` / `fourWeekDates` retained only if another surface still needs them — otherwise removed, not left dangling.
- [x] `/timesheet?view=month` renders the calendar month with a month picker (prev / next / jump), replacing the 4-week block. Week view stays the default for day-to-day entry and is unchanged — **lodgement becomes monthly, entry does not**.
- [x] Grid handles 31 columns without horizontal overflow on desktop; mobile falls back to the existing responsive treatment (TASK-220).
- [x] Periods are created lazily on first read for a person × month — no backfill of historical months.
- [x] Empty / loading / error states on the month view.
- [x] Tests: month boundaries incl. February and a leap year; `SaveSchema.dayCount` max 31 already accommodates a 31-day save (`actions.ts:33`) — assert a 31-day submit round-trips.
- [x] Typecheck + tests + lint green. Manual prod migration.
- [x] Commits: `chore(db): TimesheetPeriod model` then `feat(TASK-501): true calendar-month timesheet period`

**context:** The missing unit. Today "submitted" is a property scattered across N entry rows with no object that can be lodged, approved, or reopened as a whole — which is why every downstream stage re-derives its own grouping and they all disagree (week in the approval queue, all-time in draft-bill, arbitrary date range in draft-invoice).

**note on completion:** `chore(db): TimesheetPeriod model` (78a6739) + `feat(TASK-501): true calendar-month timesheet period` (97a4953).

**API deviation from the acceptance text:** `getMonthForPerson` takes the **month start** rather than `(year, month)`, mirroring `getWeekForPerson(personId, weekStart)`. `monthStartFrom(year, month)` converts. Same behaviour, one fewer off-by-one surface.

**Period rows are NOT created on page read.** The acceptance said "created lazily on first read"; creating on a GET means browsing an admin through a year of someone's history writes twelve `open` rows, so the page uses read-only `findTimesheetPeriod` and creation happens in the lodge action. A month with no row already reads as `open`, so nothing is lost — and the invariant "a period row exists ⇒ that person lodged that month" is what TASK-504 keys its invoice trigger off.

`startOfFourWeekBlock` / `fourWeekDates` had exactly one consumer and were removed rather than left dangling. `addMonths` rebuilds from UTC year/month parts rather than `setUTCMonth`, so 31 Jan + 1 month can't land on 2 March.

### TASK-502 — Lodge-the-month action
**status:** done
**depends on:** TASK-501
**acceptance:**
- [x] One primary action on `/timesheet` month view: "Lodge August — 142.5h across 4 projects". Transitions `TimesheetPeriod.open → lodged` and every `draft` entry in the month to `submitted`, in one transaction.
- [x] Pre-flight validation surfaced **before** the mutation fires, not as a post-hoc error: unsubmitted drafts, zero-hour working days, and hours on projects the person isn't on the team for. Each is a warning the lodger can acknowledge, except zero total hours which blocks.
- [x] Reuses `saveTimesheet`'s existing auto-approve rules (`actions.ts:224`) unchanged — a super-admin lodging their own month still skips the queue; archived projects still always require explicit approval.
- [x] Approver notification per affected project (manager / primary partner), reusing the `approval_requested` UserUpdate + `sendTimesheetApprovalQueueNotice` path from TASK-221, but framed as a month rather than a week.
- [x] Re-lodging a `lodged` period is idempotent — picks up newly added entries without duplicating notifications (the 18h WhatsApp dedupe already covers identical bodies).
- [x] A `lodged` period is read-only for the submitter; recall is via the existing `recallSubmittedTimesheet` path, which must also return the period to `open`.
- [x] AuditEvent on lodge + recall, `entityType: 'timesheet_period'`.
- [x] Server-side capability check (`timesheet.submit`), Zod on inputs.
- [x] Tests: lodge with warnings, lodge blocked on zero hours, re-lodge idempotency, recall returns period to open.
- [x] Typecheck + tests + lint green.
- [x] Commit: `feat(TASK-502): lodge-the-month action`

**note on completion:** `feat(TASK-502): lodge-the-month action` (3d00cdb).

Auto-approve rules were **extracted** to `resolveAutoApproveProjectIds` and are now shared with `saveTimesheet` rather than reimplemented — two copies would eventually disagree about who skips the queue, and an unapproved month landing in P&L is not a divergence anyone notices quickly. Archived projects still never skip (TT 2026-06-16).

Preflight separates **blockers** (no hours; already approved/invoiced → refused outright) from **warnings** (month not finished, weekdays with no hours, hours on a project the person isn't rostered on → waved through with an explicit "Lodge anyway"). The gate is server-side, not a client confirm, and the codes waved through are recorded on the audit event.

`recallSubmittedTimesheet` now reopens the period — pulling hours out of a lodged month means it's no longer a complete submission, and leaving it `lodged` would let TASK-504 invoice over hours back in draft. A recall range can straddle two months, so every month it touches is reopened, but only from `lodged`.

### TASK-503 — Person-month approval cards + approve-the-month
**status:** done
**depends on:** TASK-501
**acceptance:**
- [x] **Root cause:** `/timesheet/approve` groups pending strictly by person × **week** (`startOfWeek`, `approve/page.tsx`). A monthly lodgement shatters into ~5 weekly cards, so a manager approves the same person five times — directly opposed to batch approval.
- [x] Queue regroups by person × `TimesheetPeriod`, with per-project subtotals inside each card and the existing per-entry detail available on expand.
- [x] "Approve month" action per card. Sits underneath the existing `decideTimesheetEntries` — that action already partitions stale/undecidable IDs correctly (TASK-221) and must not be reimplemented.
- [x] A manager who leads only some of the person's projects sees and can approve **only their own** projects' entries; the card shows what's outstanding elsewhere and who owes it. The existing per-project gate in `decideTimesheetEntries` is the enforcement point.
- [x] `ApproveAllPendingButton` (firm-wide, irreversible) retained but demoted — the month card becomes the primary action. Its confirm dialog updates to say how many person-months it spans.
- [x] Period transitions to `approved` only when every entry in it is approved (D2). Partial approval leaves it `lodged`.
- [x] Send-back returns the affected entries to `draft` and the period to `open`, notifying the submitter with the reason (existing TASK-221 path).
- [x] Empty / loading / error states.
- [x] Tests: multi-project month with two approvers, partial approval does not close the period, full approval does, send-back reopens.
- [x] Typecheck + tests + lint green.
- [x] Commit: `feat(TASK-503): person-month approval cards`

**note on completion:** `feat(TASK-503): person-month approval cards` (c6353bb).

Scoping is **per project, not per card**: a manager who leads one of three projects sees the whole month (a card claiming 8h when the month is 140h is useless for deciding) but the approve action only carries entries they can decide, and the rest is listed with who owes it. A card the viewer can decide none of is dropped.

Period state is re-derived from the entries in the month, never set from what a single decision did. `invoiced` is terminal so a late send-back can't un-bill a contractor. Reconciliation deliberately **does not create** period rows — see the TASK-501 note.

`ApproveAllPendingButton` kept but demoted to the firm-wide escape hatch; it now carries only entries the viewer can decide (otherwise its confirm count would be a lie) and says how many person-months it spans.

### TASK-504 — Auto-draft the contractor invoice on period close
**status:** done
**depends on:** TASK-500, TASK-503
**acceptance:**
- [x] **Must not ship before TASK-500.** Auto-generating over today's shared `status='billed'` marker would silently destroy the client-invoice pool at scale.
- [x] When a `TimesheetPeriod` transitions to `approved` and the person is `employment: contractor`, generate a draft invoice for that **period only** — scoped by `year`/`month`, never the all-time sweep `listContractorBillableEntries` does today.
- [x] **D1 — contractor confirms.** The draft is presented to the contractor, not auto-submitted. They supply their own invoice number (required), optionally attach their own PDF, and hit "Submit invoice". Only then does the `Bill` land in `BillStatus.pending_review` for the AP gate (A7 — no agent auto-executes).
- [x] Draft is priced at `Person.rate` (contractor cost rate), grouped one line per project, GST at 10%. Rate is **snapshotted onto the bill** at generation so a later rate change can't retroactively reprice a submitted invoice.
- [x] Full-time staff never reach this surface — the existing `employment !== 'contractor'` guard is preserved and tested.
- [x] Contractor notified in-app + WhatsApp: "Your August invoice is ready to confirm — $X across N projects."
- [x] AuditEvent on generate (`actor: agent`) and on contractor confirm (`actor: person`), both carrying the period, entry IDs, hours, rate and total.
- [x] Regenerating after a send-back supersedes the prior draft rather than creating a second one.
- [x] Tests: period close fires exactly one draft; FT staff excluded; rate snapshot survives a subsequent `Person.rate` change; confirm transitions to `pending_review`; regeneration supersedes.
- [x] Typecheck + tests + lint green.
- [x] Commit: `feat(TASK-504): auto-draft contractor invoice on period close`

**note on completion:** `chore(db): invoice draft snapshot on TimesheetPeriod` (ee68f6a) + `feat(TASK-504): auto-draft the contractor invoice on period close` (0004c88).

**D1 is load-bearing in two places:** the contractor's own invoice number is *required* (making it optional would quietly turn this into an RCTI), and no `Bill` row exists until they submit. The WhatsApp wording is asserted in tests to never claim Foundry raised an invoice on their behalf — that sentence would describe an arrangement that doesn't exist.

Rate is frozen at close (`draftRateCents`), so editing `Person.rate` between close and confirm can't reprice a month that was already signed off. Only the rate is frozen; line grouping is recomputed at confirm, which is safe because a closed period's entries are all `approved` and can't move. Pricing reads `Person.rate` (contractor cost), never `Person.billRate` (client charge). A missing rate produces **no draft at all** rather than a $0 invoice — that's an admin data problem, not something to paper over.

### TASK-505 — `/me/invoices` — contractor self-serve surface
**status:** done
**depends on:** TASK-504
**acceptance:**
- [x] **Root cause:** the only invoice-generation surface today is `/directory/people/[id]/draft-bill`, gated `hasAnyRole(['super_admin','admin','partner'])` on both page and action. Contractors are `staff` role + `employment: contractor` and cannot reach it — the workflow is admin-driven, which is the opposite of "easily do this individually". Note there is no separate contractor portal: magic-link lands them in the same app, so this is a permissions + surface change, not new infrastructure.
- [x] New `/me/invoices`: the contractor's own lodged months, each showing state (`lodged` / `approved` / `invoiced`), hours, value at their rate, and the resulting `Bill` status through to paid.
- [x] Confirm-and-submit action for a generated draft (TASK-504) lives here.
- [x] Self-only by default. Admin / partner keep the existing per-person view for support cases; the old `draft-bill` page either redirects here or is retired — decide and document which.
- [x] Empty / loading / error states — a contractor with nothing lodged sees guidance pointing at `/timesheet`.
- [x] Server-side check that the viewer is the subject (or admin tier). No client-trusted person ID.
- [x] Tests: self-only enforcement, admin override, state rendering across all four period states.
- [x] Typecheck + tests + lint green.
- [x] Commit: `feat(TASK-505): contractor self-serve invoice surface`

**note on completion:** `feat(TASK-505): contractor self-serve invoice surface` (3d1e3fd).

**Decision on the old admin page: KEPT**, relabelled in-product as the *out-of-cycle* path (backfill, or a contractor who can't submit their own). Retiring it would leave no route for hours predating the period system or for offboarded people. Since TASK-500 both paths write only `contractorBillId`, so they no longer conflict — they drain the same AP pool idempotently. Its bills are tagged `outOfCycle` in the audit.

That surfaced a real gap: the admin path bills **by person, not by period**, so a month could end up fully billed while its period still said `approved`, showing the contractor an invoice prompt for hours already on a bill. `markPeriodsInvoicedIfFullyBilled` now closes those, so both routes leave the same state behind.

`/me/invoices` is period-driven, not bill-driven, on purpose: "where is my August invoice?" is usually answered by "two of your three leads haven't approved it", which a bill-driven list can't show. "My invoices" sits in the user menu for everyone rather than gated on employment — the shell doesn't know contractor vs full-time and the page explains itself to anyone on payroll.

### TASK-506 — Slow-approver mitigations: chase notice + admin force-close
**status:** done
**depends on:** TASK-503
**acceptance:**
- [x] Mitigates the known risk in D2: with full-month close, one unresponsive approver blocks a contractor's invoice and therefore their payment.
- [x] Scheduled chase: a `lodged` period with entries outstanding more than N days pings the specific approvers who owe it (in-app + WhatsApp), naming the person, the month, and the projects. N configurable via `FeatureFlag` / env, not hard-coded (A8 pattern).
- [x] Escalation to admin tier after a second interval.
- [x] Admin force-close: super_admin / admin can close a period over outstanding entries. Requires a reason, writes an AuditEvent naming what was force-approved and what was excluded, and notifies both the contractor and the bypassed approvers.
- [x] Dashboard leader-action for approvers with an overdue person-month, reusing the `leader-actions.ts` pattern.
- [x] Tests: chase fires once per interval, escalation ordering, force-close audit contents, force-closed period still generates a correct TASK-504 draft.
- [x] Typecheck + tests + lint green.
- [x] Commit: `feat(TASK-506): monthly approval chase + admin force-close`

**note on completion:** `chore(db): chase tracking on TimesheetPeriod` (5b4e917) + `feat(TASK-506): monthly approval chase + admin force-close` (6f5b5e9).

Thresholds live in **env** (`TIMESHEET_CHASE_AFTER_DAYS` / `TIMESHEET_ESCALATE_AFTER_DAYS`, defaults 3 and 7) because the `FeatureFlag` table is boolean-only; the `timesheet_chase` flag gates whether the cron runs at all, so staging can dogfood the wording before prod starts DMing partners. Cron is `0 22 * * 1-5` in `vercel.json`.

`lastChasedAt` / `escalatedAt` exist so a daily cron nudges on an interval rather than emitting a feed row every day — a notification that arrives daily is one people learn to ignore. Escalation **supersedes** a due chase rather than firing alongside it, fires once per lodgement, never targets someone about their own timesheet, and skips a month with nothing actually outstanding.

Force-close reuses the normal roll-up, so a force-closed month produces the same state and the same frozen invoice draft as an ordinary close. It requires a real reason, records which projects were bypassed and who owed each, and notifies the contractor *and* every bypassed approver.

**Not yet enabled:** the `timesheet_chase` FeatureFlag row must be created and set enabled, and `CRON_SECRET` must already be set (it is, for the existing crons). Until then the route returns `{skipped}`.

### TASK-507 — Guard against destructive migrations running ahead of deployed code
**status:** todo
**depends on:** —
**acceptance:**
- [ ] **Incident 2026-09-06 (see the Phase 8 header):** Phase 8 migrations were hand-applied to prod from an unmerged branch. The enum-value drop in TASK-500's migration broke every deployed page that read timesheet hours, because `main` was seven weeks behind and still used the value. Restored in minutes; no data lost.
- [ ] **The real gap is NOT "migrations don't run."** `scripts/vercel-build.mjs` already runs `prisma migrate deploy` on production builds, so the merge → deploy path keeps schema and code in step. The gap is that **nothing flags a migration as destructive**, and nothing stops one being applied out of band ahead of the code that needs it.
- [ ] Classify each migration additive vs destructive — a script that greps for `DROP TABLE`, `DROP COLUMN`, `DROP TYPE`, `ALTER TYPE ... RENAME`, `NOT NULL` added to an existing column, and type narrowing. Emit a manifest.
- [ ] `scripts/vercel-build.mjs` refuses to apply a **destructive** migration when `VERCEL_ENV=production` unless the commit being deployed is on the production branch. Additive migrations are unaffected.
- [ ] A `pnpm migrate:bundle` command that produces a Supabase-SQL-Editor bundle like `scripts/phase8-supabase.sql`, and **refuses to generate one containing a destructive migration** — pointing the operator at merge-then-deploy instead. Hand-applying is the path that bit us; make the safe path the easy one.
- [ ] `DEPLOY.md` §1b documents the additive-vs-destructive rule explicitly, and states that prod deploys from `main` while feature branches may be many weeks ahead.
- [ ] Tests: destructive statements detected in fixture SQL; additive migrations pass; bundle generation refuses on a destructive input.
- [ ] Commit: `feat(TASK-507): block destructive migrations from running ahead of deployed code`

**context:** Supersedes the original framing of this task ("fail the build on migration drift"), which was written from the mistaken belief that migrations weren't auto-applying. They are. Rewritten 2026-09-06 once `vercel-build.mjs` and `main`'s actual HEAD were checked.

### TASK-508 — Re-drop `TimesheetStatus.billed` (deploy AFTER Phase 8 is live)
**status:** todo
**depends on:** TASK-500, and Phase 8 being merged + deployed to prod
**acceptance:**
- [ ] Migration `20260907000000_drop_timesheet_status_billed` already written and committed. It is **guarded**: a no-op on any database where TASK-500's migration already removed the value (i.e. everything except prod), and it refuses to run while any `TimesheetEntry` still holds `status='billed'`.
- [ ] **Sequencing is the whole task. Do NOT ship this in the same deploy as the Phase 8 code.** `vercel-build.mjs` runs `migrate deploy` *before* `next build`, so a migration in the same deploy executes while the old code is still serving — reproducing the 2026-09-06 breakage, briefly. Merge and deploy Phase 8 first, confirm prod is serving the new code, then ship this in a separate deploy.
- [ ] After it runs, confirm prod matches the migration history: `select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'TimesheetStatus'` returns exactly draft / submitted / approved.
- [ ] Commit: `chore(db): re-drop TimesheetStatus.billed now Phase 8 code is live`

**context:** Prod's enum currently carries `'billed'` because it was restored by hand during the 2026-09-06 incident. Every other environment already lacks it. This is bookkeeping to bring prod back in line — there is no urgency and no data impact; an unused enum value is harmless.

### TASK-509 — Contractor expenses on the period invoice
**status:** done
**depends on:** TASK-500, TASK-504, TASK-505
**acceptance:**
- [x] **Gap:** the TASK-504 auto-draft prices hours only. `/me/invoices` has no reference to `Expense` anywhere. A contractor who spent A$400 on flights in August confirms an invoice covering their time and nothing else, then gets reimbursed separately on the pay-run cycle. Two payments, two timelines, and the invoice number they supplied covers part of what they are owed.
- [x] **D3 (TT 2026-09-10): one invoice, expenses as their own section.** Matches standard practice: a contractor issues a single monthly tax invoice with a fees section and an expenses section, itemised at cost with receipts. A separate expenses invoice is the minority pattern and is used where expenses run on a different approval or payment cycle. Contractors only; full-time staff stay on the reimbursement path (they do not invoice).
- [x] `chore(db):` migration adding `Expense.contractorBillId String?` + FK to `Bill` (`ON DELETE SET NULL`) + index. Direct mirror of `TimesheetEntry.contractorBillId` from TASK-500, for the same reason: the AP leg needs its own marker rather than overloading `status`.
- [x] Period close (TASK-504) includes the contractor's `approved` expenses with `contractorBillId IS NULL`, tagged to a project in that month, grouped onto that project's Bill alongside the hours. Expense lines are labelled and totalled separately from fee lines so the confirm screen and the Bill both read as 2 sections.
- [x] **Double-payment guard.** Once `contractorBillId` is set the expense leaves the reimbursement float: excluded from `/reimbursables`, and skipped by the pay-run builder in `src/server/payruns.ts`. Without this the same cost is paid twice, once as a reimbursement and once on the invoice.
- [x] **`rebillable` is untouched.** An expense can be on the contractor's invoice (cost in) and rebilled to the client (revenue out) at the same time. Both legs are correct and independent, exactly as hours are under TASK-500. `rebilledOnInvoiceId` and `contractorBillId` must never gate each other.
- [x] Expenses with `projectId = null` (OPEX) are excluded and stay on the reimbursement path. TASK-504 creates 1 Bill per project, so an untagged expense has no Bill to join. Surface the exclusion on `/me/invoices` so the contractor is not left wondering where the cost went.
- [x] Rate/amount frozen at close, matching how TASK-504 freezes the hourly rate, so a later edit to the expense cannot silently reprice a confirmed invoice.
- [x] Tests: expense joins the right project Bill; excluded from the reimbursement float once linked; rebillable expense still reaches the client draft; OPEX expense excluded and reported; FT staff unaffected; reimbursed expense never picked up.
- [x] Commits: `chore(db): contractorBillId on Expense` then `feat(TASK-509): contractor expenses on the period invoice`

**D4 (TT 2026-09-10): PASS-THROUGH GST.** The contractor invoices the full GST-inclusive amount they paid and adds no GST of their own on the expense lines; Foundry claims the input credit. Fee lines are the opposite: GST is added on top of hours × rate. A bill's `gst` is therefore fee GST plus the GST already contained within the pass-through lines, and `amountTotal` is fees ex-GST + fee GST + the inclusive expense total.

**Flagged, not blocking:** for a true pass-through the underlying tax invoice generally needs to be in Foundry's name. Where the receipt is in the contractor's own name the ATO usually treats it as a recharge instead, meaning the contractor claims the credit and adds their own GST. Built as TT specified; worth confirming with the accountant, and if it changes, the switch is a per-expense flag plus the arithmetic in `confirmContractorInvoice`.

**context:** Raised by TT 2026-09-10 asking whether approved project expenses reach contractor invoices. They already reach the CLIENT invoice through the `rebillable` flag and `listRebillableCostsForProject`. They did not reach the contractor's own invoice.

**note on completion:** `Expense.contractorBillId` mirrors `TimesheetEntry.contractorBillId` from TASK-500, so the AP and AR legs stay independent: a flight can be recharged to Foundry and rebilled to the client, and neither gates the other. Expenses are frozen at close alongside the rate (`draftExpenseTotalCents` / `draftExpenseGstCents` / `draftExpenseCount`), so editing one between close and confirm cannot reprice a signed-off month. Periods closed before this shipped carry no snapshot and render a zero expense section rather than failing.

Double-payment guard: `computeFirmReimbursementsAging` now filters `contractorBillId: null`, so an expense being paid through an invoice stops showing as money Foundry still owes. `payruns.ts` needed no change — it batches Bills, not Expenses, so the contractor bill is already the payment vehicle.

Untagged (OPEX) expenses stay on the reimbursement path, since confirm raises 1 Bill per project and they have none. `/me/invoices` names the count so the contractor isn't left wondering.

A project with expenses but no hours now gets its own bill, which the hours-only grouping would have dropped. The "nothing to invoice" guard moved after both legs load, so an expense-only month is no longer rejected.

Tests: 9 new, verified to fail (3 of 9) when GST is wrongly added on top of the pass-through lines. 4 existing suites needed their prisma mocks extended with the new `expense` dependency and their exact-payload assertions widened for the 3 snapshot columns. Typecheck clean, lint clean, 695 tests pass (69 files).

### TASK-512 — Merge Receipt Upload and Submitted Expenses into one page
**status:** done
**depends on:** —

**Gap (TT, 2026-10-23):** Individual Inputs carried two entries, `Receipt Upload` (`/bills/intake`) and `Submitted Expenses` (`/expenses`), for one errand. Both opened a drop target, neither showed the whole flow, and the names describe a step rather than a question — so people guessed. `/bills/intake` compounded it by rendering two unrelated pages off one route: an AP vendor-bill review surface for admins, and a bare dropzone plus a 5-row "your recent uploads" echo for everyone else, which was a worse version of `/expenses`.

**acceptance:**
- [x] `/expenses` is the single personal surface: `1 · Upload a receipt` (the `IntakeDropzone`) above `2 · Submitted` (the existing filters / list / by-project views). H1 is now `Expenses`.
- [x] `/bills/intake` keeps only the vendor-AP job — retitled `AP Intake`, staff-mode branch and the recent-uploads card deleted, non-reviewers redirected to `/expenses`. The split is now by question (who gets paid), not by step (upload vs track).
- [x] One nav entry, `Expenses`. `Receipt Upload` removed; AP intake stays reachable from `/bills` and from a cross-link on `/expenses` for `bill.create` holders.
- [x] Every other entry point repointed: both dashboard action strips, the project cost card, Navan integration copy, assistant `SURFACES` blurbs, onboarding spotlight (`nav-/bills/intake` → `nav-/expenses`).
- [x] `revalidatePath('/expenses')` added to the Navan sync actions — they write `Expense` rows, which now render on the merged page.
- [x] Typecheck + lint clean on every file touched; 695 tests pass.
- [x] Commit: `feat(TASK-512): merge receipt upload into the expenses page`

**Flagged, not fixed — `bill.create` and `ensureCanReview` disagree.** `bill.create` is `super_admin / admin / associate_partner`; `ensureCanReview` in `bills/intake/actions.ts` is `super_admin / admin / partner`. An associate_partner can therefore raise a vendor bill and has no surface on which to review it, and a partner can review bills they cannot raise. Pre-existing; surfaced by this merge because an AP would now be bounced to `/expenses` by the new redirect. Worked around rather than resolved: `IntakeDropzone` takes a `canReviewBills` prop and only navigates to the review pane for people who have one — the bill queues for an admin either way. **Resolving it is a product decision (TT): should an associate_partner review AP bills, or lose `bill.create`?**

**note on completion:** the dropzone component stays at `bills/intake/dropzone.tsx` and is imported by both pages rather than copied — one upload path, two framings. `/expenses` passes `defaultKind="expense"`, `/bills/intake` passes `"bill"`, so each page defaults to its own answer while the per-row toggle still rescues an upload that landed on the wrong one.

### TASK-510 — Make contractor invoicing reachable: sidebar entry + timesheet call-to-action
**status:** todo
**depends on:** TASK-505

**Gap (TT, 2026-10-23):** `/me/invoices` has shipped since TASK-505 but is reachable only from the avatar dropdown — `nav-config.ts` had no entry for it. A contractor looking at the sidebar saw Timesheet / Availability / Receipts / Expenses under Individual Inputs and concluded the firm had no self-invoicing. The feature existing and the feature being findable are not the same thing, and for a surface whose entire job is "get paid", the second one is the product.

**acceptance:**
- [x] `My invoices` nav item under **Individual Inputs**, directly under Timesheet (it is the thing the timesheet feeds). Visible to every signed-in role — the page already explains itself to full-time staff rather than 404ing, so gating the nav entry on employment would need `employment` threaded into the shell for no benefit.
- [x] Icon distinct from both `FileText` (Invoices (Receivables)) and `Receipt` (Expenses) so the three don't read as the same surface — `ReceiptText`.
- [ ] Explicit **Generate invoice** call-to-action on `/timesheet`, present in week view as well as month view — the month view is not where a contractor starts.
- [ ] The CTA states the actual gate ("approved hours") rather than being a bare link, so the contractor learns the rule from the button instead of from a dead end.
- [ ] Full-time staff never see the CTA — they do not invoice, and an invoice button on a payroll employee's timesheet is a support ticket.
- [ ] Acting-on-behalf (admin viewing someone else's timesheet) carries `personId` through, matching the existing `/availability` link.
- [ ] Test: nav visibility for each role; CTA hidden for `ft`, shown for `contractor`.
- [ ] Commit: `feat(TASK-510): generate-invoice CTA on the timesheet`

**note (2026-10-23):** the nav half of this shipped inside another session's commit `85897a7 feat(TASK-512)`, which swept the working tree while three sessions were editing the same checkout. The entry is correct and in place; only the timesheet CTA remains.

### TASK-513 — Open a new timesheet on last period's projects, not every allocation
**status:** done
**depends on:** TASK-501

**Gap (TT, 2026-10-23):** the grid opened with every non-archived `ProjectTeam` allocation the person held. Allocation is a poor proxy for what someone is actually working on — people sit on project teams for months without touching them — so every sheet arrived carrying rows that had to be deleted by hand before it could be filled in. The complaint was specifically about having to *remove* projects, which is work the app created.

**acceptance:**
- [x] `getRangeForPerson` takes an optional `carryForward: { start, end }`. When set, rows come from the projects with entries in THAT window rather than from allocations.
- [x] `getWeekForPerson` carries the previous 7 days; `getMonthForPerson` carries the previous **calendar** month (a fixed 31-day lookback would start inside February and miss its first days).
- [x] Self-cleaning by construction: a zero-hour row leaves no `TimesheetEntry` (saveTimesheet deletes it), so a project drops off the sheet the period after you stop logging to it. No new "remove this row" affordance needed.
- [x] Anything with hours in the CURRENT period always shows, whatever its stage or allocation — hiding a row holding real hours would lose data.
- [x] Archived projects are never carried forward. Logging to a wrapped engagement stays a deliberate act via the add-row picker, which still offers every project.
- [x] Fallback: when nothing was logged last period (new starter, back from leave) the sheet falls back to allocations rather than opening empty and making them hunt through the picker for their own projects.
- [x] The "Copy last week" lookup opts out (`carryForwardPrevious: false`) — it wants last week's hours, and carrying forward would make its row list reflect the week before that.
- [x] Tests: 9 new covering both views, the calendar-month boundary, the year roll-over, the archived exclusion, the current-period override, the empty-period fallback, and the copy-last-week opt-out.
- [x] Typecheck + lint clean; 718 tests pass (71 files).
- [x] Commit: `feat(TASK-513): open the timesheet on last period's projects`

**note on completion:** deliberately keyed off entries rather than adding a "pinned rows" table. Pinning would need its own management UI and would drift from reality the same way allocation did; derived state can't go stale.

Fixed three pre-existing type errors surfaced on the way — see the commit. `tsc` runs with `"incremental": true` and a stale `tsconfig.tsbuildinfo` was skipping files, so several earlier "typecheck clean" claims in this phase were made against a cache rather than a full check. **Worth a follow-up:** make `pnpm typecheck` delete the buildinfo first, or drop `incremental`, so the gate means what it says.

### TASK-511 — Date-range contractor invoice (`/me/invoices`)
**status:** todo
**depends on:** TASK-504, TASK-505, TASK-509, TASK-510

**Gap (TT, 2026-10-23):** every contractor invoice path is whole-calendar-month. `TimesheetPeriod` is keyed `personId + year + month`, the rate snapshot freezes at month close, and `confirmContractorInvoice` derives its window from `monthStartFrom(year, month)`. A contractor who starts mid-month, finishes mid-month, bills a quarter at once, or simply wants 15 Sep – 14 Oct has no path. The admin out-of-cycle route (`/directory/people/[id]/draft-bill`) is unbounded-all-approved-hours, not a range, and is admin-only regardless.

**acceptance:**
- [ ] Start + end date inputs on `/me/invoices`, defaulting to the current month so the existing month-at-a-time habit still works in one click.
- [ ] Preview groups **approved + unbilled** entries in range by project, with hours, rate, ex-GST, GST, total.
- [ ] **Unapproved time in the same range is listed, not hidden** — hours, project, and the approver it is waiting on. Excluded from the invoice: approved-only is the gate the whole flow rests on (D2), and a range picker must not become the way around it. The contractor's question is "why is my invoice short", and the answer is a name.
- [ ] **Per-entry rate resolution.** Entries inside a period that closed with a `draftRateCents` price at that frozen rate; everything else at the contractor's current `Person.rate`. A range spanning a closed month and an open one must not silently reprice the closed part — that is the exact repricing TASK-504 exists to prevent, and a range window reintroduces it unless rates resolve per entry.
- [ ] Pass-through expenses on the same terms as TASK-509: `approved`, `contractorBillId IS NULL`, project-tagged, inside the range, GST-inclusive with no GST added on top (D3/D4). Untagged OPEX expenses excluded and the count surfaced.
- [ ] One `Bill` per project, `pending_review`, so the AP queue keeps its human gate (A7).
- [ ] **Double-billing is structurally impossible:** both paths gate on `contractorBillId IS NULL` and set it in the same transaction. A range overlapping an already-invoiced month picks up nothing from the billed part.
- [ ] Affected periods reconciled through the existing `markPeriodsInvoicedIfFullyBilled` so a month fully consumed by range invoices closes rather than sitting at `approved` forever showing a phantom prompt.
- [ ] Range validation: end on or after start, bounded span, dates parseable; rejected server-side, not just in the browser.
- [ ] `AuditEvent` per bill recording the range, which rate priced which hours, and that it came from the range path (A9).

**D5 (TT, 2026-10-23): the generate screen is a form, not a receipt.**
- [ ] **Every field on the generate screen is editable** — invoice number, issue date, due date, the personal identifier, and the per-project fee lines. The month path presents frozen figures for confirmation; this one is the contractor composing their own document, so nothing is read-only text that should have been an input.
- [ ] **Invoice number is autogenerated and prefilled**, coding the contractor's initials and a per-person sequence (`{INITIALS}-{YYYY}-{NNN}`, e.g. `JN-2026-004`). The sequence is derived from that person's existing bills, so two contractors never collide and neither does a contractor with themselves.
- [ ] **The generated number stays editable.** D1 (TT 2026-08-31) turns on the invoice being the contractor's own document rather than a recipient-created tax invoice; a number they cannot change is Foundry issuing on their behalf. Prefilling is a convenience, locking it is an RCTI.
- [ ] **Collision check on submit.** Reject a number this contractor has already used rather than silently creating a second bill under the same reference — the suggestion is only a default, and an edited one can collide.
- [ ] **Optional personal identifier** the contractor adds to the invoice description (their own PO, client ref, engagement nickname). Free text, their words, carried onto the Bill so it survives into AP and Xero rather than living only in the audit trail.
- [ ] `chore(db):` migration adding `Bill.description String?`. The Bill model has no description/notes column today — `confirmContractorInvoice` drops its `notes` into the `AuditEvent` only, so nothing the contractor writes reaches the document itself. Separate commit, applied manually to prod (migrations do not auto-run).

**acceptance (tests):**
- [ ] Tests: range spanning two months with one closed; partial month; range overlapping already-billed entries yields nothing; frozen vs current rate applied per entry; unapproved surfaced but never billed; expense-only range; FT staff refused; cross-person refused; number autogeneration increments per person; duplicate number rejected; personal identifier reaches `Bill.description`.
- [ ] Commits: `chore(db): description on Bill` then `feat(TASK-511): date-range contractor invoice`

### TASK-514 — Timesheet look-back: lock approved days, add month + quarter review
**status:** done

**Gap (TT, 2026-10-23):** stepping back through a timesheet was broken in two ways at once.

1. **Approved days looked editable.** `TimesheetRow.status` collapses to `mixed` the moment a row straddles an approval boundary — last week approved, this week draft — which is most rows a person meets when they go back to check something. The grid decided editability per ROW, so on a mixed row every day rendered as an open input. `saveTimesheet` has refused to rewrite an approved entry since it was written (`if (isLocked && !isSuperAdmin) continue`), so typing into one of those days did nothing and said nothing. The UI was more permissive than the save, which is the wrong way round.
2. **Only week and month existed.** Reaching anything older than the current month meant clicking Previous one week at a time.

**acceptance:**
- [x] `TimesheetCell` carries `status` and `billed` per DAY, so the grid can lock a single day inside a mixed row.
- [x] One lock rule, in `src/lib/timesheet-lock.ts`, shared by the grid, the assistant prefill and the tests — `lib/` rather than `server/timesheet.ts` because the client grid must not pull Prisma into its bundle. Mirrors the `saveTimesheet` guard: billed (either leg) locked for everyone, approved locked for everyone but super admin, draft/submitted/empty open.
- [x] A locked day renders as the NUMBER plus a lock glyph, not a greyed-out input — a disabled box still reads as "you could type here", and the figure is the thing worth seeing when checking an earlier week. A hidden field keeps the payload shape unchanged.
- [x] Per-row "N locked" chip, and a legend under the grid saying why and what to do about it (ask an approver to send it back; void the document if it is billed).
- [x] Remove hidden on a row holding locked days — it only drops the row in the browser, so the hours would return on refresh. Recall now offered on mixed rows, not just all-submitted ones.
- [x] "Copy last week" skips locked target days.
- [x] Assistant prefill ignores a locked DAY with reason `locked_day`, not just a locked row.
- [x] Quarter view: `?view=quarter`, projects × the quarter's three months, read-only. 90-odd editable columns is not a grid, and a quarter is what someone opens to check history. Each column header links into that month; period state (open / lodged / approved / invoiced) shown per month; four stat tiles split the quarter into logged / approved-or-billed / awaiting approval / still draft.
- [x] Calendar quarters, whose boundaries are also the AU FY quarters — only the count differs — so the label names both: "Jul–Sep 2026 · FY27 Q1".
- [x] Week / Month / Quarter toggle carries the anchor date across, so switching view keeps you in the same place in time rather than jumping to today. Prev/Next step by the view's own unit.
- [x] Fixed three-letter month abbreviations in `lib/week.ts` — `Intl` en-AU `month: 'short'` returns "July", "Sept" and "June" next to "Aug", which makes a header row ragged.
- [x] Tests: quarter boundary maths incl. year rollover and FY numbering; the per-day lock rule for each status × role; the quarter roll-up (grouping, mixed months, AR vs AP leg, empty quarter).
- [x] Commit: `feat(TASK-514): per-day timesheet locks + quarter review view` — landed inside commit `67c07c1`, which another session wrote against its own TASK-513 while both of us had uncommitted work in the same checkout. The code is in; the commit message only describes the carry-forward change.

**note on completion:** the server was already correct — no permission or save change was needed, and none was made. This closes the gap between what the grid offered and what the save would accept. Not yet exercised in a browser against real data: the local DB credentials are stale (see memory `foundry_local_db_unreachable`), so the grid and quarter table have been verified by typecheck, lint and unit tests only.

### TASK-514 — Edit / delete a receipt or expense after submission
**status:** todo
**depends on:** TASK-512

**Gap (TT, 2026-10-23):** a receipt goes up, Sonnet reads it, and whatever it got wrong is frozen. There is no way for the submitter to fix a misread supplier, amount, date or project tag, and no way to delete a duplicate or a receipt uploaded to the wrong account. The only route today is asking an admin.

**acceptance:**
- [ ] Submitter can edit their own expense while it is still `draft` or `submitted` — supplier, amount, GST, date, project tag, category, description.
- [ ] Submitter can delete their own expense while it is still `draft` or `submitted`.
- [ ] **Approved and beyond is not freely editable.** Once `approved` the expense is a number somebody signed off, and once `reimbursed` or linked to a `contractorBillId` it is money that has moved or is moving. Edit/delete there is admin-only and must re-open the approval rather than silently amending a signed-off figure.
- [ ] **Never editable once consumed by a contractor bill** (`contractorBillId` set) — the expense is on an invoice that is in the AP queue or already paid. Amend the bill, not the line underneath it.
- [ ] Admin override for every state, with the reason captured.
- [ ] `AuditEvent` on every edit and delete with the before/after delta (A9) — this is a financial record, and "the amount changed" must always have an actor and a timestamp.
- [ ] Re-running OCR after an edit must not clobber the human's correction.
- [ ] Tests: self-edit allowed in draft/submitted; refused once approved; refused once `contractorBillId` is set; admin override audited; delete refused for someone else's expense.
- [ ] Commit: `feat(TASK-514): edit + delete own expenses before approval`

**overlap warning:** `/expenses` was restructured by TASK-512 in a parallel session on 2026-10-23. Build this on top of that page, not against the pre-merge layout.

### TASK-515 — Expenses invoice separately from timesheet fees
**status:** blocked — needs TT
**depends on:** TASK-509, TASK-511

**Ask (TT, 2026-10-23):** "the invoice/expenses needs to generate a separate invoice from timesheets" — expenses should produce their own invoice document rather than riding on the fee invoice.

**BLOCKER — this reverses D3, and D3 is six weeks old and live.** D3 (TT, 2026-09-10, TASK-509) chose the opposite explicitly: *"one invoice, expenses as their own section… Matches standard practice: a contractor issues a single monthly tax invoice with a fees section and an expenses section. A separate expenses invoice is the minority pattern and is used where expenses run on a different approval or payment cycle."* That shipped in `58b5885` and is what `confirmContractorInvoice` does today.

Reversing it is a legitimate call — the usual reason is exactly the one D3 names, expenses running on a different approval or payment cycle, which is true here since expense approval and timesheet approval are separate gates. But it is a reversal, not a gap, so it needs TT to say which before anything is built:

- [ ] **Q1 — both paths or just the range path?** The month path (`confirmContractorInvoice`) and the range path (`generateRangeContractorInvoice`) both currently merge expenses into the fee bill. Changing one and not the other means a contractor's September invoice and their 15 Sep – 14 Oct invoice behave differently.
- [ ] **Q2 — separate invoice, or separate Bill?** Today one invoice already becomes several `Bill` rows, one per project. "Separate invoice" could mean (a) a second invoice number for the expense lines, or (b) the same number with expense bills split out. (a) is a real second document the contractor numbers themselves; (b) is a presentation change inside Foundry.
- [ ] **Q3 — does the GST treatment survive?** D4 pass-through (contractor adds no GST on expense lines, Foundry reclaims the input credit) was decided alongside D3. A standalone expenses invoice does not change the GST logic, but it does make the pass-through much more visible to the ATO, and the "receipt in the contractor's own name" concern already flagged on TASK-509 becomes harder to leave open.

**acceptance (once answered):**
- [ ] Expense lines raise their own Bill(s) with their own invoice number, independent of the fee bill.
- [ ] `TimesheetPeriod` expense snapshot columns (`draftExpenseTotalCents` / `draftExpenseGstCents` / `draftExpenseCount`) either keep working or are migrated — they exist to stop an expense edit repricing a signed-off month.
- [ ] Double-payment guard holds: `contractorBillId` still takes the expense out of the reimbursement float either way.
- [ ] Commit: `feat(TASK-515): expenses invoice separately from fees`

---

*End of TASKS.md. Start with TASK-001.*
