# CLAUDE.md — Foundry Ops

You are implementing **Foundry Ops**, the internal operating platform for Foundry Health (a ~12-person healthcare strategy consultancy, AU/NZ). This file is loaded into every Claude Code session. Read it at the start of every task.

## Read first, in this order

1. **This file** (`CLAUDE.md`) — conventions, guardrails, ralph-loop rules.
2. **`HANDOFF.md`** — the single source of truth for data model, roles, integrations, agents, and build order. When the HTML prototype and HANDOFF.md conflict, HANDOFF.md wins.
3. **`BUILD_ORDER.md`** — the ordered phase plan. Don't jump phases.
4. **`TASKS.md`** — ralph-sized atomic tasks with acceptance criteria. Pick the first `status: todo` task. Never invent your own tasks — if something is missing, add it to `TASKS.md` and flag it, don't silently build it.
5. **`schema.prisma`** — canonical DB schema. The source of truth for entity shapes.
6. **`AGENTS.md`** — per-agent spec (receipt parser, AP intake, invoice drafter, contract drafter, AR chaser, timesheet reconciler, Xero reconciler).
7. **`INTEGRATIONS.md`** — per-integration spec (M365, Xero, pay.com.au, WhatsApp, DocuSign).
8. **The HTML prototype** (`Foundry Ops.html` + `screens-*.jsx`) — reference for UX, layout, component density. **Not** production code to copy.
9. **`screenshots/`** — every major screen as a PNG, numbered and labelled.

## Locked architectural decisions (do not re-litigate)

| # | Decision |
|---|---|
| A1 | **Database is authoritative.** Excel exports are read-only snapshots (nightly + on-demand). No 2-way sync with Excel. |
| A2 | **Foundry app is identity master.** M365 account provisioning is triggered from the Directory screen. Role comes from Entra group membership in production. |
| A3 | **SharePoint/OneDrive for all files.** App stores pointers (URLs) only — never binary content. |
| A4 | **LLM: Claude (Anthropic API).** `claude-sonnet` for structured extraction, `claude-haiku` for classification/routing. |
| A5 | **Single M365 tenant** (`foundry.health`). No B2B guests. Contractor portal uses magic link. |
| A6 | **Deny-by-default permissions.** List what a role can do, not what it can't. |
| A7 | **All agents are human-in-the-loop.** No agent auto-executes destructive actions. Every agent has a queue surface. |
| A8 | **Approval thresholds are configurable, not hard-coded.** Defaults: invoice >$20k → Super Admin; expense >$2k → Super Admin; pay run → Super Admin. |
| A9 | **Audit every mutation.** `AuditEvent` rows are non-negotiable — actor (person or agent), action, entity, delta, at, ip, ua, source. |

## Tech stack (assumed unless already chosen)

If there's no existing codebase:

- **Frontend:** Next.js 14+ (app router), TypeScript, Tailwind, shadcn/ui
- **Backend:** Next.js route handlers + server actions. Monolith is fine at this scale.
- **DB:** Postgres, Prisma
- **Auth:** NextAuth with Entra ID provider (tenant-restricted to `foundry.health`); magic-link for contractors
- **Queue/agents:** Inngest (preferred) or BullMQ. Agents are workflows, not one-shot prompts.
- **File storage:** SharePoint via Microsoft Graph. **No S3.**
- **Observability:** Sentry + Langfuse (or equivalent) for LLM call logging
- **Validation:** Zod. Every LLM output is schema-validated; every API input is schema-validated.

If the codebase already exists, **match what's there**. Don't introduce a second framework.

## Coding conventions

- **TypeScript strict.** No `any` without a comment explaining why.
- **Server-side permission checks on every mutation.** Never trust the client role. Middleware reads the session, resolves the person's roles, and the handler explicitly lists the required capability.
- **Every LLM output goes through Zod.** If validation fails, retry up to 3 times with the error fed back in the prompt; if it still fails, mark the agent run `awaiting_human` and surface it in the queue.
- **Every destructive action writes an `AuditEvent`.** Same transaction as the mutation.
- **Money is integer cents (bigint).** Never float. Currency column always present.
- **Timestamps are `timestamptz` (UTC).** Render in user timezone on the client.
- **Feature flags:** use env vars + a `FeatureFlag` table. Every integration ships behind a flag so staging can dogfood before prod enables.
- **Error handling:** no silent catches. Log, surface to user if user-visible, re-throw if unexpected.

## File conventions

- `src/app/` — route tree (Next.js app router)
- `src/components/` — React components (port `shared.jsx` / `components-shared.jsx` primitives first)
- `src/server/` — server-only code (DB, integrations, agents, permissions)
- `src/server/agents/<agent-name>/` — one folder per agent: `prompt.ts`, `schema.ts`, `workflow.ts`, `run.test.ts`
- `src/server/integrations/<integration>/` — one folder per integration: `client.ts`, `sync.ts`, `types.ts`
- `prisma/schema.prisma` — source of truth for DB
- `prisma/seed.ts` — staging seed, drawn from `foundry-team.jsx` + `foundry-ratecard.jsx`

## Ralph-loop rules (read carefully — this is how you work)

**You are running in an autonomous loop.** Each iteration you do one ralph-sized task and hand back. Follow these rules:

1. **Always start by reading `TASKS.md` and picking the first `status: todo` task.** Do not skip tasks. If the task depends on an unstarted task, do that dependency first.
2. **Work one task at a time.** A ralph-sized task is: "build one screen and wire it to its API route" or "add one integration surface" or "build one agent through to queue + schema validation." If a task feels bigger than 2–4 hours of focused work, split it — add sub-tasks to `TASKS.md` and pick the first.
3. **Acceptance criteria are gates, not suggestions.** Every task in `TASKS.md` has a checklist. You are not done until every box is checked. If you can't satisfy a box, explain why in the commit message and leave the task open.
4. **Write the test before the code where the task includes a test box.** For server actions, write a unit test. For agents, write a golden-file test against fixture inputs.
5. **After every task:**
   a. Run typecheck + tests + lint. Fix until green.
   b. Update `TASKS.md`: mark the task `status: done`, add a one-line note on what was done (and anything skipped).
   c. If you discovered new tasks, append them at the bottom of the relevant phase with `status: todo`.
   d. Commit with a message that names the task ID: `feat(TASK-023): invoice approval route + audit event`.
6. **Never modify `HANDOFF.md` or this `CLAUDE.md` without an explicit task in `TASKS.md` saying so.** If you think something is wrong, open an issue — don't silently rewrite the spec.
7. **Never fake a passing test.** If a test fails because the feature isn't built yet, the feature isn't done.
8. **Ask for missing decisions — don't guess.** If a task requires a product decision that isn't in `HANDOFF.md` or any spec file, stop the task, add a `BLOCKER:` note in `TASKS.md`, and move to the next unblocked task.
9. **Prefer small PRs / commits.** One task = one commit. If a task requires a migration, separate commits: `chore(db): migration for X` then `feat(TASK-NNN): use X`.
10. **Respect the locked decisions above.** If a task seems to contradict them, it's wrong — add a BLOCKER note.

## What "done" looks like for a task

A task is done when **all** of:

- All acceptance-criteria boxes checked
- Typecheck green (`tsc --noEmit`)
- Tests green for the new surface
- Lint clean (`eslint --max-warnings=0`)
- If a schema change: `prisma generate` + `prisma migrate dev` clean, and `prisma/seed.ts` still runs
- If a new route: server-side permission check present, audit event written, Zod validation on inputs
- Commit message references the task ID

## What to do when stuck

Stuck = 2+ iterations without progress on the same task.

1. Write down what you've tried in a `NOTES.md` under the task folder (or append to the task in `TASKS.md`).
2. Mark the task `status: blocked` with a clear reason.
3. Pick the next unblocked task.

Do not delete failing tests. Do not disable typecheck. Do not `// @ts-ignore` through errors.

## Security — non-negotiable

- **PII fields** on Person (`bank_bsb`, `bank_acc`, `super_fund_id`, `tax_file_number`) are encrypted at rest, readable only by Super Admin / Admin roles. Use column-level encryption (pgcrypto or app-level AES-GCM with a KMS-held key).
- **Secrets in env** — never in code. Use a vault in production.
- **Session cookies** are httpOnly, secure, sameSite=lax, rotated on role change.
- **CSRF:** every mutation requires a token; Next.js server actions handle this by default — if you use route handlers instead, add a middleware.
- **Rate limiting** on auth, magic-link send, and every inbound webhook.
- **Webhook verification:** Xero and DocuSign send signed webhooks — verify signatures before trusting payload.
- **WhatsApp mutating actions** require the source number to match a registered person, and MFA for anything >$20k (A8).

## Don't do these

- Don't port `styles.css` or `hifi.css` verbatim — extract the **tokens** into Tailwind theme config. Avoid shipping the prototype's raw CSS.
- Don't keep `localStorage` as the persistence layer for anything server-knowable. It's a prototype shortcut only.
- Don't keep the top-right role switcher. Role comes from Entra group membership.
- Don't auto-send invoices/bills/contracts. All send steps are gated on the approval queue.
- Don't ship any agent without schema validation + retry + queue-for-human fallback.
- Don't build a page without an empty state, a loading state, and an error state. The prototype shows the happy path only.
- Don't invent data — the seed must come from `foundry-team.jsx` and `foundry-ratecard.jsx`. Production starts empty except for rate card.

---

*End of CLAUDE.md. Now open `TASKS.md` and pick the first `status: todo` task.*
