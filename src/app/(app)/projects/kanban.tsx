'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition, useCallback } from 'react';
import type { ProjectStage } from '@prisma/client';
import { PersonAvatar } from '@/components/person-avatar';
import {
  moveProject,
  reorderProjectsInStage,
  type MoveProjectState,
  type ReorderState,
} from './actions';
import { CardAddMember, type CardPersonOption } from './card-add-member';

// Lanes where within-column priority ranking is intentionally disabled.
// Archived projects are history — they don't need an order. (Internal
// FHP lanes standing/benched ARE rankable so they're not listed here.)
const REORDER_DISABLED_STAGES: ReadonlySet<ProjectStage> = new Set<ProjectStage>([
  'archived',
]);

// Stable comparator for in-column display order. Ranked cards
// (sortOrder ≥ 1) appear in ascending order; unranked cards (the
// default 0 a freshly-created project carries) fall to the bottom,
// tie-broken by code so the layout is deterministic.
function compareForColumn(
  a: { sortOrder: number; code: string },
  b: { sortOrder: number; code: string },
): number {
  const aRanked = a.sortOrder > 0;
  const bRanked = b.sortOrder > 0;
  if (aRanked && bRanked) return a.sortOrder - b.sortOrder;
  if (aRanked) return -1;
  if (bRanked) return 1;
  return a.code.localeCompare(b.code);
}

type KanbanProject = {
  id: string;
  code: string;
  name: string;
  clientLegalName: string;
  stage: ProjectStage;
  contractValueCents: number;
  startDateIso: string | null;
  endDateIso: string | null;
  actualEndDateIso: string | null;
  team: Array<{
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  }>;
  weekIndex: number; // weeks elapsed (capped)
  weekTotal: number; // 0 when dates missing
  progressPct: number;
  qcStatus: 'green' | 'amber' | 'red';
  paid: boolean;
  sortOrder: number;
};

type OptimisticAction =
  | { type: 'move'; id: string; toStage: ProjectStage }
  | { type: 'reorder'; stage: ProjectStage; orderedIds: string[] };

const STAGE_LABEL: Record<ProjectStage, string> = {
  kickoff: 'Setup',
  delivery: 'Active',
  closing: 'Wrapping',
  archived: 'Closed',
  standing: 'Standing',
  benched: 'Benched',
};
const STAGE_HINT: Record<ProjectStage, string> = {
  kickoff: 'contract · team · code',
  delivery: 'in delivery',
  closing: 'final weeks · invoicing',
  archived: 'paid · reconciled',
  standing: 'ongoing · always on',
  benched: 'paused · may return',
};
// Client engagements move through the original four stages.
const CLIENT_PIPELINE: ProjectStage[] = ['kickoff', 'delivery', 'closing', 'archived'];
// Internal FHP projects use a different set: Set up → Active →
// Standing (ongoing, always-on) → Benched (paused but may come back).
// They never hit closing/archived because they don't reconcile a
// contract; benched is the equivalent of "shelved for now".
const INTERNAL_PIPELINE: ProjectStage[] = ['kickoff', 'delivery', 'standing', 'benched'];
const INTERNAL_LABEL_OVERRIDE: Partial<Record<ProjectStage, string>> = {
  kickoff: 'Set up',
};

/**
 * Internal FH projects use the FHP-prefixed code series — FHP001
 * (Homefield Partners), FHP002 (primer development), FHP003 (social
 * media) and so on. They render as a separate band on the kanban so
 * the team can see firm-internal initiatives at a glance without
 * mixing them in with client engagements. The three pure-overhead
 * expense buckets (FHB / FHO / FHX) are already filtered out of the
 * project list at the server, so this check only sees real projects.
 */
function isInternalProject(code: string): boolean {
  return code.startsWith('FHP');
}

export function ProjectsKanban({
  projects,
  canCreate,
  canMove,
  canAddTeam,
  allPeople,
}: {
  projects: KanbanProject[];
  canCreate: boolean;
  canMove: boolean;
  /** Whether the viewer can add team members to a project from the
   *  card (matches the server-side `project.edit` capability — admin /
   *  partner / project lead). */
  canAddTeam: boolean;
  /** Active people pool. Each card filters out the project's existing
   *  team members so the dropdown only shows valid candidates. */
  allPeople: CardPersonOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Closed column is collapsed by default — leadership doesn't need it
  // visible on every page-load. Click to reveal when reviewing.
  const [closedHidden, setClosedHidden] = useState(true);
  // Optimistic state — covers both cross-column moves (stage change)
  // and within-column reorders (sortOrder renumber). Server truth wins
  // on refresh either way.
  const [optimisticProjects, dispatch] = useOptimistic<
    KanbanProject[],
    OptimisticAction
  >(projects, (current, action) => {
    if (action.type === 'move') {
      return current.map((p) =>
        p.id === action.id ? { ...p, stage: action.toStage } : p,
      );
    }
    // Reorder: assign sortOrder 1..N to the cards in the column in
    // the supplied order; leave other columns alone.
    const indexById = new Map(action.orderedIds.map((id, i) => [id, i + 1]));
    return current.map((p) =>
      indexById.has(p.id) ? { ...p, sortOrder: indexById.get(p.id)! } : p,
    );
  });

  const handleDrop = useCallback(
    (projectId: string, toStage: ProjectStage) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project || project.stage === toStage) return;
      setError(null);
      const fd = new FormData();
      fd.set('projectId', projectId);
      fd.set('toStage', toStage);
      startTransition(async () => {
        dispatch({ type: 'move', id: projectId, toStage });
        const result = (await moveProject({ status: 'idle' }, fd)) as MoveProjectState;
        if (result.status === 'error') {
          setError(result.message);
          // useOptimistic auto-reverts when the transition completes without
          // a router.refresh() pulling fresh data — but we explicitly refresh
          // to make sure the DB truth wins regardless of outcome.
          router.refresh();
        } else {
          router.refresh();
        }
      });
    },
    [projects, dispatch, router],
  );

  const handleReorder = useCallback(
    (stage: ProjectStage, orderedIds: string[]) => {
      if (orderedIds.length === 0) return;
      if (REORDER_DISABLED_STAGES.has(stage)) return;
      setError(null);
      const fd = new FormData();
      fd.set('stage', stage);
      fd.set('orderedIds', orderedIds.join(','));
      startTransition(async () => {
        dispatch({ type: 'reorder', stage, orderedIds });
        const result = (await reorderProjectsInStage(
          { status: 'idle' },
          fd,
        )) as ReorderState;
        if (result.status === 'error') {
          setError(result.message);
        }
        router.refresh();
      });
    },
    [dispatch, router],
  );

  // Two bands: client engagements on top, internal FH initiatives
  // (FHP series — primers, social, brand work, etc) on the bottom.
  // Each band renders the same four-stage pipeline so a project moves
  // through Setup → Active → Wrapping → Closed regardless of band.
  const clientProjects = optimisticProjects.filter(
    (p) => !isInternalProject(p.code),
  );
  const internalProjects = optimisticProjects.filter((p) =>
    isInternalProject(p.code),
  );

  const groupByStage = (cards: KanbanProject[]) => {
    const g: Record<ProjectStage, KanbanProject[]> = {
      kickoff: [],
      delivery: [],
      closing: [],
      archived: [],
      standing: [],
      benched: [],
    };
    for (const p of cards) g[p.stage].push(p);
    for (const stage of Object.keys(g) as ProjectStage[]) {
      g[stage].sort(compareForColumn);
    }
    return g;
  };

  const clientGrouped = groupByStage(clientProjects);
  const internalGrouped = groupByStage(internalProjects);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {error}
        </div>
      )}
      {pending && <div className="text-xs text-ink-3">Saving move…</div>}

      <KanbanBand
        title="Client projects"
        subtitle="Engagements with paying clients — Foundry's revenue surface."
        count={clientProjects.length}
        grouped={clientGrouped}
        pipeline={
          closedHidden
            ? CLIENT_PIPELINE.filter((s) => s !== 'archived')
            : CLIENT_PIPELINE
        }
        labelOverride={null}
        canCreate={canCreate}
        canMove={canMove}
        canAddTeam={canAddTeam}
        allPeople={allPeople}
        onDrop={handleDrop}
        onReorder={handleReorder}
        newProjectHref="/projects/new"
        closedToggle={{
          hidden: closedHidden,
          count: clientGrouped.archived.length,
          onToggle: () => setClosedHidden((v) => !v),
        }}
      />

      <KanbanBand
        title="Internal projects · FHP series"
        subtitle={
          'Standing + episodic FH initiatives. Primer development, social ' +
          'media, brand work — projects that may pause and come back.'
        }
        count={internalProjects.length}
        grouped={internalGrouped}
        pipeline={INTERNAL_PIPELINE}
        labelOverride={INTERNAL_LABEL_OVERRIDE}
        canCreate={canCreate}
        canMove={canMove}
        canAddTeam={canAddTeam}
        allPeople={allPeople}
        onDrop={handleDrop}
        onReorder={handleReorder}
        newProjectHref="/projects/new?kind=internal"
        emptyHint={
          canCreate
            ? 'No internal projects yet — create one with a code starting in FHP (e.g. FHP002 Primer development).'
            : 'No internal projects yet.'
        }
      />
    </div>
  );
}

/**
 * One horizontal band of the kanban — header + four stage columns.
 * Both the client-projects band and the internal-projects band reuse
 * this so they render identically apart from the title and the empty
 * state copy.
 */
function KanbanBand({
  title,
  subtitle,
  count,
  grouped,
  pipeline,
  labelOverride,
  canCreate,
  canMove,
  canAddTeam,
  allPeople,
  onDrop,
  onReorder,
  emptyHint,
  newProjectHref,
  closedToggle,
}: {
  title: string;
  subtitle: string;
  count: number;
  grouped: Record<ProjectStage, KanbanProject[]>;
  /** Stage columns this band renders, in order. Client engagements
   *  use kickoff/delivery/closing/archived; internal projects use
   *  kickoff/delivery/standing/benched. */
  pipeline: ProjectStage[];
  /** Per-band label overrides — e.g. internal band shows "Set up"
   *  instead of "Setup" for the kickoff column to match the rest of
   *  the internal-band copy. Pass null when no override is needed. */
  labelOverride: Partial<Record<ProjectStage, string>> | null;
  canCreate: boolean;
  canMove: boolean;
  canAddTeam: boolean;
  allPeople: CardPersonOption[];
  onDrop: (projectId: string, toStage: ProjectStage) => void;
  onReorder: (stage: ProjectStage, orderedIds: string[]) => void;
  /** Where the "+ New project code" affordance points. Internal band
   *  pre-selects the internal kind via `?kind=internal`. */
  newProjectHref: string;
  emptyHint?: string;
  /** Optional toggle for hiding the Closed column on the client band.
   *  Internal band passes undefined since its pipeline doesn't include
   *  archived. */
  closedToggle?: {
    hidden: boolean;
    count: number;
    onToggle: () => void;
  };
}) {
  // Grid columns track pipeline length so the layout collapses when
  // the Closed column is hidden. Tailwind needs literal classes at
  // build time — list both variants so JIT keeps them.
  const gridClass =
    pipeline.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3';
  return (
    <section>
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {title}
            <span className="ml-2 text-xs tabular-nums text-ink-3">
              {count}
            </span>
          </h2>
          <p className="text-[11px] text-ink-3">{subtitle}</p>
        </div>
        {closedToggle && (
          <button
            type="button"
            onClick={closedToggle.onToggle}
            className="rounded-md border border-line bg-surface-elev px-2.5 py-1 text-[11px] text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            {closedToggle.hidden
              ? `Show closed (${closedToggle.count})`
              : 'Hide closed'}
          </button>
        )}
      </header>
      {count === 0 && emptyHint ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-subtle/30 p-6 text-center text-xs text-ink-3">
          {emptyHint}
        </div>
      ) : (
        <div className={`grid grid-cols-1 gap-4 ${gridClass}`}>
          {pipeline.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              label={labelOverride?.[stage] ?? STAGE_LABEL[stage]}
              hint={STAGE_HINT[stage]}
              count={grouped[stage].length}
              cards={grouped[stage]}
              canCreate={canCreate && stage === 'kickoff'}
              canMove={canMove}
              canAddTeam={canAddTeam}
              allPeople={allPeople}
              onDrop={onDrop}
              onReorder={onReorder}
              newProjectHref={newProjectHref}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function KanbanColumn({
  stage,
  label,
  hint,
  count,
  cards,
  canCreate,
  canMove,
  canAddTeam,
  allPeople,
  onDrop,
  onReorder,
  newProjectHref,
}: {
  stage: ProjectStage;
  label: string;
  hint: string;
  count: number;
  cards: KanbanProject[];
  canCreate: boolean;
  canMove: boolean;
  canAddTeam: boolean;
  allPeople: CardPersonOption[];
  onDrop: (projectId: string, toStage: ProjectStage) => void;
  onReorder: (stage: ProjectStage, orderedIds: string[]) => void;
  newProjectHref: string;
}) {
  const [hovering, setHovering] = useState(false);
  // Insertion indicator state: which card is being hovered, and is the
  // drop landing above or below its midline. `null` = no line drawn
  // (e.g. dragging over the column gutter rather than a card).
  const [insertion, setInsertion] = useState<
    { targetId: string; pos: 'before' | 'after' } | null
  >(null);
  const reorderable = canMove && !REORDER_DISABLED_STAGES.has(stage);
  const dotColor =
    stage === 'kickoff'
      ? 'bg-status-green'
      : stage === 'delivery'
        ? 'bg-status-green'
        : stage === 'closing'
          ? 'bg-status-amber'
          : 'bg-status-green';

  // Compute the post-drop ID order for a within-column reorder. Pulls
  // the dragged card out of its current slot (if it's already in this
  // column) and re-inserts it at the index implied by (targetId, pos).
  // Cross-column drops never reach here — they fall through to the
  // existing onDrop branch in the column-level drop handler.
  const computeReorder = (
    draggedId: string,
    targetId: string,
    pos: 'before' | 'after',
  ): string[] | null => {
    if (draggedId === targetId) return null;
    const ids = cards.map((c) => c.id);
    const fromIdx = ids.indexOf(draggedId);
    let targetIdx = ids.indexOf(targetId);
    if (targetIdx === -1) return null;
    if (fromIdx !== -1) ids.splice(fromIdx, 1);
    targetIdx = ids.indexOf(targetId); // recompute after splice
    const insertIdx = pos === 'after' ? targetIdx + 1 : targetIdx;
    ids.splice(insertIdx, 0, draggedId);
    const before = cards.map((c) => c.id).join('|');
    const after = ids.join('|');
    if (before === after) return null;
    return ids;
  };

  return (
    <div
      onDragOver={(e) => {
        if (!canMove) return;
        e.preventDefault();
        setHovering(true);
      }}
      onDragLeave={(e) => {
        // Only clear when the drag really leaves the column — children
        // firing dragleave shouldn't kill the hover state.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setHovering(false);
        setInsertion(null);
      }}
      onDrop={(e) => {
        if (!canMove) return;
        e.preventDefault();
        const projectId = e.dataTransfer.getData('text/project-id');
        const wasInsertion = insertion;
        setHovering(false);
        setInsertion(null);
        if (!projectId) return;

        // Within-column reorder path: card-level drop already captured
        // the target+pos before bubbling up.
        if (wasInsertion && reorderable) {
          const draggedCard = cards.find((c) => c.id === projectId);
          if (draggedCard) {
            const next = computeReorder(
              projectId,
              wasInsertion.targetId,
              wasInsertion.pos,
            );
            if (next) onReorder(stage, next);
            return;
          }
          // Card not in this column → fall through to cross-column move.
        }
        onDrop(projectId, stage);
      }}
      className={`rounded-xl border bg-surface-subtle/40 p-3 transition-colors ${
        hovering
          ? 'border-brand bg-surface-hover/40'
          : 'border-line'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
          <span className="text-sm font-semibold text-ink">{label}</span>
          <span className="text-xs tabular-nums text-ink-3">{count}</span>
        </div>
        <span className="text-[11px] text-ink-3">{hint}</span>
      </div>
      <div className="space-y-3">
        {cards.length === 0 && !canCreate && (
          <div className="rounded-lg border border-dashed border-line p-6 text-center text-xs text-ink-4">
            Empty
          </div>
        )}
        {cards.map((card) => (
          <KanbanCard
            key={card.id}
            card={card}
            canMove={canMove}
            canAddTeam={canAddTeam}
            allPeople={allPeople}
            reorderable={reorderable}
            insertionPos={
              insertion && insertion.targetId === card.id ? insertion.pos : null
            }
            onCardDragOver={(targetId, pos) => {
              if (!reorderable) return;
              setInsertion((prev) =>
                prev && prev.targetId === targetId && prev.pos === pos
                  ? prev
                  : { targetId, pos },
              );
            }}
          />
        ))}
        {canCreate && (
          <Link
            href={newProjectHref}
            className="block rounded-lg border border-dashed border-line p-6 text-center text-xs text-ink-3 hover:border-brand hover:text-brand"
          >
            + New project code
          </Link>
        )}
      </div>
    </div>
  );
}

function KanbanCard({
  card,
  canMove,
  canAddTeam,
  allPeople,
  reorderable,
  insertionPos,
  onCardDragOver,
}: {
  card: KanbanProject;
  canMove: boolean;
  canAddTeam: boolean;
  allPeople: CardPersonOption[];
  /** True when this column allows within-column priority ranking
   *  (i.e. the column isn't a read-only history lane). */
  reorderable: boolean;
  /** When non-null, render the insertion indicator line above
   *  (`before`) or below (`after`) this card. */
  insertionPos: 'before' | 'after' | null;
  /** Fired on dragover while the cursor is over THIS card. Tells the
   *  parent column where the insertion line should sit. */
  onCardDragOver: (targetId: string, pos: 'before' | 'after') => void;
}) {
  const dotColor =
    card.qcStatus === 'red'
      ? 'bg-status-red'
      : card.qcStatus === 'amber'
        ? 'bg-status-amber'
        : 'bg-status-green';
  const totalWeeks = card.weekTotal || 0;
  const closedPaid = card.stage === 'archived' && card.paid;
  const closedSummary = card.stage === 'archived'
    ? `— · closed${card.paid ? ' · paid' : ''}`
    : null;
  // "10w · kickoff 22 Apr" / "12w · wk 7/12" / "— · closed · paid"
  let footerLabel = '—';
  if (closedSummary) {
    footerLabel = closedSummary;
  } else if (card.stage === 'kickoff') {
    if (card.startDateIso) {
      const d = new Date(card.startDateIso);
      footerLabel = `${totalWeeks ? `${totalWeeks}w · ` : ''}kickoff ${d.toLocaleDateString(
        'en-AU',
        { day: 'numeric', month: 'short' },
      )}`;
    } else {
      footerLabel = totalWeeks ? `${totalWeeks}w · awaiting kickoff` : 'awaiting kickoff';
    }
  } else if (totalWeeks > 0) {
    footerLabel = `${totalWeeks}w · wk ${card.weekIndex}/${totalWeeks}`;
  }

  // Filter the candidate pool down to people not already on this team.
  const teamIds = new Set(card.team.map((p) => p.id));
  const addOptions = allPeople.filter((p) => !teamIds.has(p.id));

  return (
    <div className="relative">
      {insertionPos === 'before' && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-1.5 h-0.5 rounded-full bg-brand"
        />
      )}
      {insertionPos === 'after' && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-1.5 h-0.5 rounded-full bg-brand"
        />
      )}
    <div
      draggable={canMove}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/project-id', card.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!reorderable) return;
        // Determine whether the cursor is above or below the midline.
        const rect = e.currentTarget.getBoundingClientRect();
        const pos: 'before' | 'after' =
          e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        // Suppress the parent column's plain drag-over handling so we
        // don't double-render hover styling — but DO call
        // preventDefault here so the drop target stays valid.
        e.preventDefault();
        e.stopPropagation();
        onCardDragOver(card.id, pos);
      }}
      className={`group rounded-lg border border-line bg-card p-4 shadow-sm transition-shadow ${
        canMove ? 'cursor-grab active:cursor-grabbing hover:shadow-md' : ''
      }`}
      title={
        reorderable
          ? 'Drag within the column to rank · drag between columns to change stage'
          : canMove
            ? 'Drag to another column to change stage'
            : undefined
      }
    >
      {/* Reflowed header (per TT, 2026-05-10):
           Row 1 — client legal name (regular weight, small)
           Row 2 — project code (bold) + project name (bold) inline
           QC dot stays top-right as the at-a-glance health pip. */}
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/projects/${card.code}`}
          className="block min-w-0 flex-1 hover:underline"
        >
          <div className="truncate text-xs text-ink-3">{card.clientLegalName}</div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-sm font-semibold text-ink">
              {card.code}
            </span>
            <span className="text-sm font-semibold text-ink">{card.name}</span>
          </div>
        </Link>
        <span
          className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${dotColor}`}
          title={`QC ${card.qcStatus}`}
        />
      </div>

      {!closedPaid && (
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-surface-subtle">
          <div
            className="h-full bg-status-green"
            style={{ width: `${Math.min(100, card.progressPct)}%` }}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center">
          <div className="flex -space-x-2">
            {card.team.slice(0, 5).map((p) => (
              <PersonAvatar
                key={p.id}
                className="h-6 w-6 border-2 border-card bg-surface-elev"
                fallbackClassName="text-[9px]"
                initials={p.initials}
                headshotUrl={p.headshotUrl}
                title={`${p.firstName} ${p.lastName}`}
              />
            ))}
            {card.team.length > 5 && (
              <span className="ml-2 self-center text-[10px] text-ink-3">
                +{card.team.length - 5}
              </span>
            )}
          </div>
          {canAddTeam && (
            <CardAddMember projectId={card.id} options={addOptions} />
          )}
        </div>
        <span className="text-[11px] tabular-nums text-ink-3">{footerLabel}</span>
      </div>
    </div>
    </div>
  );
}
