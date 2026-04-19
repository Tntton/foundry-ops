# Foundry Ops — Design Handoff to Claude Code

## Overview

This bundle contains the design for **Foundry Ops**, the internal operating platform for Foundry Health — a ~12-person healthcare strategy consultancy in Australia (with NZ staff). The platform consolidates their day-to-day operations: projects, P&L, timesheets, invoices, expenses, BD pipeline, partner true-up, resource planning, directory, approvals, and 7 human-in-the-loop agents. It replaces a sprawl of Excel workbooks on OneDrive + manual Xero entry + WhatsApp approvals.

## If you're running a Claude Code / ralph-loop session, start here

Read in this order:

1. **`CLAUDE.md`** — operating manual for the ralph loop. Locked architectural decisions, coding conventions, per-task "done" criteria, security must-haves. Load this into every session.
2. **`HANDOFF.md`** — single source of truth for the data model, role matrix, integration contracts, agent catalog, build order.
3. **`BUILD_ORDER.md`** — ordered phase plan (Phase 0 Foundation → Phase 5 Polish).
4. **`TASKS.md`** — ralph-sized atomic tasks with dependencies + acceptance criteria. Start at TASK-001; never skip ahead.
5. **`schema.prisma`** — canonical Postgres schema. Copy into `prisma/` verbatim for the first migration.
6. **`AGENTS.md`** — per-agent spec (7 agents): trigger, input, output, approval gate, model, fixtures.
7. **`INTEGRATIONS.md`** — per-integration spec (5 integrations): auth, scopes, surfaces, webhook verification, feature flags.
8. **HTML prototype** (`Foundry Ops.html` + `screens-*.jsx`) — reference for UX only, not production code.
9. **`screenshots/`** — 19 numbered PNGs covering every major screen across roles.

## About the design files

The files in this bundle are **design references created in HTML** — a React + inline-JSX prototype demonstrating the intended look, flow, and interaction model of every screen. They are **not production code to copy directly**.

Your task is to **recreate these HTML designs in the target codebase's existing environment** (or, if no environment exists yet, to choose an appropriate stack — `HANDOFF.md §6` has suggestions) using its established patterns and libraries. When the prototype and `HANDOFF.md` conflict, `HANDOFF.md` wins — see `HANDOFF.md §8` for the prototype→production mapping.

## Fidelity

**High-fidelity.** The prototype has final colors, typography, spacing, iconography, and interaction behavior. Component density, table layouts, drawer patterns, approval flows, and approvals-queue visuals should be recreated pixel-close. Design tokens live in `hifi.css` and `styles.css`; a port of these tokens (e.g. into Tailwind theme config or shadcn tokens) will get you most of the way.

## How to navigate the prototype

Open `Foundry Ops.html` in a browser. Use the **role switcher** (top-right) to see screens from the perspective of each of the five roles: Super Admin, Admin, Partner, Manager, Staff. The sidebar is role-filtered, so a Staff member sees only Timesheet, Expenses, My week, Projects. The login page (`screens-auth.jsx`) includes a mock Microsoft 365 SSO flow you can walk through before landing in the app.

## Screens & views (inventory)

All screens are inventoried in `HANDOFF.md §9`. In summary:

**Workspace (main) screens:**
- **My week** (Staff) — personal utilisation, timesheet gaps, assigned projects
- **Manager dashboard** (Manager) — team utilisation, project health
- **Firm dashboard** (Super Admin / Admin / Partner) — configurable section grid: cash position, AR aging, utilisation, partner pool, BD pipeline, upcoming milestones
- **Projects** — list + detail (tabs: Brief, Team, Milestones, P&L, Files, Settings, Risks)
- **Cost planning** — OPEX lines, forecast
- **P&L overview** — firm P&L, waterfall, forecast sandbox
- **BD pipeline** — deals, kanban by stage, deal detail drawer, deal→project conversion
- **Approvals** — central inbox with filters by type (invoice, expense, bill, pay run, contract, hire, rate change)
- **Partner true-up** — period close, pool computation, payout rows
- **Resource planning** — allocation × capacity matrix
- **Directory** — people + clients + contractors + partners
- **Reports** — canned reports + export
- **Integrations & Agents** — 5 integrations with per-surface detail, 7 agents with run history & approval policies

**Input screens:**
- **Timesheet** — week grid, project picker, hour entry, submit
- **Invoice Foundry** (contractor self-invoice) — magic-link portal variant lives in `screens-portals.jsx`
- **Invoices** — AR intake, draft review, approval queue
- **Expenses** — submit + approve
- **New project wizard** — provisions SharePoint folder + Xero tracking category

**System screens:**
- **Templates** — document template library
- **Master admin** — firm-level config
- **Admin** — Admin-role config (integrations, SSO)

**Hidden:**
- **My profile** (`screens-me.jsx`) — reached via avatar menu; tabs for Profile, Notifications, Security, Personal integrations, Pay & tax

## Role & permission model

See `HANDOFF.md §1` for the full matrix. Five hierarchical roles (Super Admin, Admin, Partner, Manager, Staff); a person can hold multiple roles. Deny-by-default. Approval thresholds (invoice >$20k → Super Admin; expense >$2k → Super Admin; pay run → Super Admin) are configurable, not hard-coded.

## Interactions & behavior

The prototype demonstrates:
- **Approvals queue UX** — adaptive card pattern, side-by-side diff for bill/invoice review, one-click approve/reject with required decision notes.
- **Agent human-in-the-loop** — every agent surface has a draft → review → accept/edit/reject flow; no agent auto-executes.
- **Drawer pattern** — heavy use of right-side drawers for detail views (deal, line item, directory person, cost plan, resource, true-up). Drawer width ~640px; content scrolls; primary actions pinned to footer.
- **Wizard pattern** — multi-step sidebars for New Project, New Client, New Person.
- **Role switching** — in the prototype only; in production, role comes from Entra group membership (see `HANDOFF.md §8`).
- **Persistence** — the prototype saves UI state (current screen, dashboard layout, expanded sections) to localStorage so refreshes don't lose context. In production, move to a `UserPreference` table.

## State management

Prototype uses React `useState` per screen and `localStorage` for persistence. In production, expect server-side state (role, session, permissions, approvals queue) + client cache (TanStack Query / SWR) + a small amount of UI-local state. Audit every mutation — `HANDOFF.md §2` defines the `AuditEvent` shape.

## Design tokens

All tokens are in `hifi.css` (primary) and `styles.css`. Key values:

- **Brand primary:** Foundry orange `#D97757` (used for primary CTAs, active nav, badges)
- **Neutrals:** warm grey scale — background `#FAFAF8`, elevated `#FFFFFF`, subtle `#F5F4F0`, divider `#E8E6E0`, border `#D9D6CF`, text `#1F1E1A`, muted `#6B6962`
- **Status:** green `#2F8F5E` (approved, paid), amber `#D69E2E` (pending, overdue soon), red `#C53030` (rejected, overdue)
- **Typography:** system sans stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", ...`) for UI; mono for codes/numbers
- **Radii:** 6px (small), 10px (cards), 12px (drawers/modals)
- **Shadows:** `0 1px 2px rgba(0,0,0,.04)` on cards; `0 12px 32px rgba(0,0,0,.16)` on floating menus
- **Density:** 44px row height in tables; 14px base font; 13px for dense table cells

Full token list: open `hifi.css`.

## Assets

All assets are in `assets/`. The Foundry Health mark (`assets/fh-mark.png`) and any client/person avatars are placeholders — replace with real assets at integration time. Icons are inline SVG via the `Icon` component in `shared.jsx`.

## Files in this bundle

| File | Purpose |
|---|---|
| **`CLAUDE.md`** | **Ralph-loop operating manual — load into every Claude Code session.** |
| **`BUILD_ORDER.md`** | Ordered phase plan (Phase 0–5). |
| **`TASKS.md`** | Ralph-sized atomic tasks with dependencies + acceptance criteria. |
| **`schema.prisma`** | Canonical Postgres schema. Copy into `prisma/` verbatim. |
| **`AGENTS.md`** | Per-agent spec for all 7 human-in-the-loop agents. |
| **`INTEGRATIONS.md`** | Per-integration spec for M365, Xero, pay.com.au, WhatsApp, DocuSign. |
| **`HANDOFF.md`** | **Primary developer handoff — read first. Data model, roles, integrations, agents, build order.** |
| `README.md` | This file. |
| `Foundry Ops.html` | App shell — nav, role switcher, auth gate, screen router. Entry point. |
| `Foundry Ops Wireframe.html` | Earlier lofi wireframe — reference only, hifi supersedes. |
| `hifi.css` | Design tokens (colors, spacing, typography, shadows). Port these first. |
| `styles.css` | Layout + component CSS. |
| `shared.jsx` / `components-shared.jsx` | UI primitives: Button, Badge, Icon, Avatar, KPI, Card, Table, Drawer, Modal, Tabs. |
| `foundry-team.jsx` | PERSON_DB fixture — real Foundry team with bands, levels, rates, employment status. |
| `foundry-ratecard.jsx` | Rate card fixture. |
| `screens-auth.jsx` | Login page, Microsoft 365 SSO modal (email→password→MFA→role picker), logout flow. |
| `screens-1.jsx` … `screens-8.jsx` | Main workspace screens (dashboard, invoices, expenses, approvals, etc.). |
| `screens-dash.jsx` | Firm dashboard with configurable section layout. |
| `screens-projects.jsx` | Projects list + tabbed project detail. |
| `screens-project-settings-risks.jsx` | Project-scoped Settings & Risks tabs. |
| `screens-wizard.jsx` | New project wizard sidebar. |
| `screens-client-wizard.jsx` | New client wizard. |
| `screens-directory-people.jsx` | Directory + new-person wizard (provisions M365). |
| `screens-directory-drawers.jsx` | Directory detail drawers (person, client, contractor). |
| `screens-pnl.jsx` | Firm P&L, waterfall chart, forecast sandbox. |
| `screens-costplan.jsx` + `screens-costplan-drawer.jsx` | Cost planning + OPEX line drawer. |
| `screens-bd-admin.jsx` + `screens-bd-drawer.jsx` | BD pipeline + deal drawer + deal→project conversion. |
| `screens-line-drawers.jsx` | Invoice / expense / bill line-item drawers. |
| `screens-resource-drawer.jsx` | Resource allocation drawer. |
| `screens-trueup-drawer.jsx` | Partner true-up row drawer. |
| `screens-me.jsx` | Self-service profile (Profile, Notifications, Security, Personal integrations, Pay & tax tabs). |
| `screens-integrations-agents.jsx` | Integrations & Agents dashboard — 5 integrations with per-surface detail, 7 agents, approval policies. |
| `screens-portals.jsx` | Contractor / supplier magic-link portals. |
| `screens-modals-final.jsx` | Shared modal library. |
| `assets/` | Logos, placeholder images, icons. |

## Build order

See `HANDOFF.md §5` for the full phased plan. Quick summary:

1. **Phase 1 — Operational core (~8–12 weeks)** — auth, data model, role middleware, audit log, Directory, Projects, Timesheets, Expenses, Invoices, Bills, Approvals queue, Xero one-way push, Excel exports.
2. **Phase 2 — Firm intelligence (~weeks 12–20)** — P&L, Cost planning, BD pipeline + conversion, Resource planning, Partner true-up.
3. **Phase 3 — Agents (~weeks 18–30, overlaps phase 2)** — orchestration infra, then receipt parser, AP intake, timesheet reconciler, Xero reconciler, invoice drafter, contract drafter, AR chaser.
4. **Phase 4 — Payments & comms (~weeks 24–32)** — ABA generation, pay.com.au, WhatsApp, DocuSign, Teams notifications.

## Stack recommendation

See `HANDOFF.md §6`. Shortest path that matches the prototype's shape: **Next.js + TypeScript + Tailwind + shadcn/ui + Postgres (Prisma/Drizzle) + NextAuth with Entra ID + Inngest for agent jobs**. Claude Code should substitute whatever is already in place if a codebase exists.

## Open items

`HANDOFF.md §7` lists decisions that should be resolved during build — super fund integration, FX support, receipt OCR fallback, WhatsApp template pre-approval, ABA format variant per bank, MFA-for-WhatsApp-approvals acceptability, agent cost caps.

---

*Start with `HANDOFF.md`, then open `Foundry Ops.html` in a browser and walk the prototype with the role switcher.*
