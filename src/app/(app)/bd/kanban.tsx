'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition, useCallback } from 'react';
import type { DealStage } from '@prisma/client';
import { PersonAvatar } from '@/components/person-avatar';
import {
  moveDeal,
  quickCreateDeal,
  reorderDealsInStage,
  type MoveDealState,
  type QuickCreateState,
  type ReorderDealsState,
} from './actions';

// Closed lanes — drag still works for stage change INTO them (closing
// out a deal), but in-column ranking is disabled because won/lost
// columns are history, not a priority queue.
const REORDER_DISABLED_STAGES: ReadonlySet<DealStage> = new Set<DealStage>([
  'won',
  'lost',
]);

// Stable comparator for in-column display order. Ranked deals
// (sortOrder ≥ 1) appear in ascending order; unranked deals (the
// default 0 a freshly-created deal carries) fall to the bottom, with
// `code` as a deterministic tie-breaker.
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

export type QuickCreateOwner = {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
};

export type QuickCreateClient = {
  id: string;
  code: string;
  legalName: string;
};

export type KanbanDeal = {
  id: string;
  code: string;
  name: string;
  stage: DealStage;
  clientLabel: string | null; // "ACME · ACME Corp Pty Ltd" or "Prospective Co. (prospective)"
  clientCode: string | null; // routes to /directory/clients/{id} via parent
  clientId: string | null;
  prospectiveName: string | null;
  archivedAt: string | null;
  expectedValueCents: number;
  weightedValueCents: number;
  probabilityPct: number;
  daysSinceLastConversation: number | null;
  clientType: string | null;
  engagementType: string | null;
  owner: {
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  };
  sortOrder: number;
};

type DealOptimisticAction =
  | { type: 'move'; id: string; toStage: DealStage }
  | { type: 'reorder'; stage: DealStage; orderedIds: string[] };

const STAGE_LABEL: Record<DealStage, string> = {
  lead: 'Lead',
  qualifying: 'Qualifying',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
};
const STAGE_HINT: Record<DealStage, string> = {
  lead: 'inbound · cold',
  qualifying: 'discovery · fit check',
  proposal: 'scoping · pricing',
  negotiation: 'red-lining · sign-off',
  won: 'converted to project',
  lost: 'closed-lost · archive',
};
const STAGE_DOT: Record<DealStage, string> = {
  lead: 'bg-ink-3',
  qualifying: 'bg-status-amber',
  proposal: 'bg-status-blue',
  negotiation: 'bg-status-blue',
  won: 'bg-status-green',
  lost: 'bg-status-red',
};
const PIPELINE: DealStage[] = [
  'lead',
  'qualifying',
  'proposal',
  'negotiation',
  'won',
  'lost',
];

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function prettyEnum(v: string | null): string {
  if (!v) return '';
  return v.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function DealsKanban({
  deals,
  canCreate,
  canMove,
  quickCreateOwners,
  quickCreateClients,
  defaultOwnerId,
  commercialsVisible,
}: {
  deals: KanbanDeal[];
  canCreate: boolean;
  canMove: boolean;
  /** Owner picklist used by the inline quick-create form. */
  quickCreateOwners: QuickCreateOwner[];
  /** Client picklist used by the inline quick-create form. */
  quickCreateClients: QuickCreateClient[];
  /** Pre-selects the current user when they're an eligible owner. */
  defaultOwnerId: string | null;
  /** When false, hide all $ amounts on cards + column headers. Partners
   *  toggle this off during team huddles so values don't flash. */
  commercialsVisible: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimistic state — same pattern as ProjectsKanban: snap the card to
  // its new column instantly, server commits in the background, refresh
  // pulls truth back regardless of outcome.
  const [optimisticDeals, dispatch] = useOptimistic<
    KanbanDeal[],
    DealOptimisticAction
  >(deals, (current, action) => {
    if (action.type === 'move') {
      return current.map((d) =>
        d.id === action.id ? { ...d, stage: action.toStage } : d,
      );
    }
    const indexById = new Map(action.orderedIds.map((id, i) => [id, i + 1]));
    return current.map((d) =>
      indexById.has(d.id) ? { ...d, sortOrder: indexById.get(d.id)! } : d,
    );
  });

  const handleDrop = useCallback(
    (dealId: string, toStage: DealStage) => {
      const deal = deals.find((d) => d.id === dealId);
      if (!deal || deal.stage === toStage) return;
      setError(null);
      const fd = new FormData();
      fd.set('dealId', dealId);
      fd.set('toStage', toStage);
      startTransition(async () => {
        dispatch({ type: 'move', id: dealId, toStage });
        const result = (await moveDeal({ status: 'idle' }, fd)) as MoveDealState;
        if (result.status === 'error') {
          setError(result.message);
        }
        router.refresh();
      });
    },
    [deals, dispatch, router],
  );

  const handleReorder = useCallback(
    (stage: DealStage, orderedIds: string[]) => {
      if (orderedIds.length === 0) return;
      if (REORDER_DISABLED_STAGES.has(stage)) return;
      setError(null);
      const fd = new FormData();
      fd.set('stage', stage);
      fd.set('orderedIds', orderedIds.join(','));
      startTransition(async () => {
        dispatch({ type: 'reorder', stage, orderedIds });
        const result = (await reorderDealsInStage(
          { status: 'idle' },
          fd,
        )) as ReorderDealsState;
        if (result.status === 'error') {
          setError(result.message);
        }
        router.refresh();
      });
    },
    [dispatch, router],
  );

  const grouped: Record<DealStage, KanbanDeal[]> = {
    lead: [],
    qualifying: [],
    proposal: [],
    negotiation: [],
    won: [],
    lost: [],
  };
  for (const d of optimisticDeals) {
    grouped[d.stage].push(d);
  }
  for (const stage of Object.keys(grouped) as DealStage[]) {
    grouped[stage].sort(compareForColumn);
  }

  return (
    <div>
      {error && (
        <div className="mb-3 rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {error}
        </div>
      )}
      {pending && <div className="mb-3 text-xs text-ink-3">Saving move…</div>}
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1200px] grid-cols-6 gap-3">
          {PIPELINE.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              label={STAGE_LABEL[stage]}
              hint={STAGE_HINT[stage]}
              dotColor={STAGE_DOT[stage]}
              cards={grouped[stage]}
              // Inline quick-create is allowed in every stage except
              // `lost` (closed-lost shouldn't be a net-new entry point).
              // Won is now a plain stage with no auto-conversion side
              // effect, so partners can drop a deal directly there if it
              // arrives already-won.
              canCreate={canCreate && stage !== 'lost'}
              canMove={canMove}
              onDrop={handleDrop}
              onReorder={handleReorder}
              quickCreateOwners={quickCreateOwners}
              quickCreateClients={quickCreateClients}
              defaultOwnerId={defaultOwnerId}
              commercialsVisible={commercialsVisible}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function KanbanColumn({
  stage,
  label,
  hint,
  dotColor,
  cards,
  canCreate,
  canMove,
  onDrop,
  onReorder,
  quickCreateOwners,
  quickCreateClients,
  defaultOwnerId,
  commercialsVisible,
}: {
  stage: DealStage;
  label: string;
  hint: string;
  dotColor: string;
  cards: KanbanDeal[];
  canCreate: boolean;
  canMove: boolean;
  onDrop: (dealId: string, toStage: DealStage) => void;
  onReorder: (stage: DealStage, orderedIds: string[]) => void;
  quickCreateOwners: QuickCreateOwner[];
  quickCreateClients: QuickCreateClient[];
  defaultOwnerId: string | null;
  commercialsVisible: boolean;
}) {
  const [hovering, setHovering] = useState(false);
  const [insertion, setInsertion] = useState<
    { targetId: string; pos: 'before' | 'after' } | null
  >(null);
  const reorderable = canMove && !REORDER_DISABLED_STAGES.has(stage);
  const expected = cards.reduce((s, d) => s + d.expectedValueCents, 0);
  const weighted = cards.reduce((s, d) => s + d.weightedValueCents, 0);

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
    targetIdx = ids.indexOf(targetId);
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
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setHovering(false);
        setInsertion(null);
      }}
      onDrop={(e) => {
        if (!canMove) return;
        e.preventDefault();
        const dealId = e.dataTransfer.getData('text/deal-id');
        const wasInsertion = insertion;
        setHovering(false);
        setInsertion(null);
        if (!dealId) return;
        if (wasInsertion && reorderable) {
          const draggedCard = cards.find((c) => c.id === dealId);
          if (draggedCard) {
            const next = computeReorder(
              dealId,
              wasInsertion.targetId,
              wasInsertion.pos,
            );
            if (next) onReorder(stage, next);
            return;
          }
        }
        onDrop(dealId, stage);
      }}
      className={`rounded-xl border bg-surface-subtle/40 p-3 transition-colors ${
        hovering ? 'border-brand bg-surface-hover/40' : 'border-line'
      }`}
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
          <span className="text-sm font-semibold text-ink">{label}</span>
          <span className="text-xs tabular-nums text-ink-3">{cards.length}</span>
        </div>
        {commercialsVisible && (
          <div className="text-right text-[10px] text-ink-3">
            <div className="tabular-nums">{formatMoney(expected)}</div>
            {weighted !== expected && (
              <div className="tabular-nums text-ink-4">
                {formatMoney(weighted)} wt.
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mb-2 text-[10px] uppercase tracking-wide text-ink-4">
        {hint}
      </div>
      <div className="space-y-2">
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
            commercialsVisible={commercialsVisible}
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
          <QuickCreate
            stage={stage}
            owners={quickCreateOwners}
            clients={quickCreateClients}
            defaultOwnerId={defaultOwnerId}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Inline "+ Add deal" form, collapsed to a single dashed button until
 * clicked. Shows ONLY mandatory fields (owner + client-or-prospective);
 * stage is implicit from the column. Everything else (name, value,
 * probability, engagement type) is filled in afterwards on the deal
 * detail page — keeps the kanban add path under five seconds.
 */
function QuickCreate({
  stage,
  owners,
  clients,
  defaultOwnerId,
}: {
  stage: DealStage;
  owners: QuickCreateOwner[];
  clients: QuickCreateClient[];
  defaultOwnerId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string>(defaultOwnerId ?? '');
  const [clientId, setClientId] = useState<string>('');
  const [prospective, setProspective] = useState<string>('');
  const [projectDetail, setProjectDetail] = useState<string>('');

  function reset() {
    setOpen(false);
    setError(null);
    setClientId('');
    setProspective('');
    setProjectDetail('');
    // Keep the chosen owner sticky between adds — partners typically
    // batch-add their own deals one after another.
  }

  function submit() {
    setError(null);
    if (!ownerId) {
      setError('Pick an owner.');
      return;
    }
    if (!clientId && !prospective.trim()) {
      setError('Pick a client or type a prospective name.');
      return;
    }
    const fd = new FormData();
    fd.set('stage', stage);
    fd.set('ownerId', ownerId);
    if (clientId) fd.set('clientId', clientId);
    if (prospective.trim()) fd.set('prospectiveName', prospective.trim());
    if (projectDetail.trim())
      fd.set('prospectiveProjectDetail', projectDetail.trim());
    startTransition(async () => {
      const result = (await quickCreateDeal(
        { status: 'idle' },
        fd,
      )) as QuickCreateState;
      if (result.status === 'error') {
        setError(result.message);
        return;
      }
      reset();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full rounded-lg border border-dashed border-line p-3 text-center text-xs text-ink-3 hover:border-brand hover:text-brand"
      >
        + Add deal
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-brand bg-card p-3 shadow-sm">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">
        New deal · {stage}
      </div>
      <label className="block text-[10px] text-ink-3">
        Owner
        <select
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          className="mt-1 flex h-8 w-full rounded-md border border-line bg-surface-elev px-2 text-xs text-ink"
        >
          <option value="">Pick an owner…</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.initials} · {o.firstName} {o.lastName}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[10px] text-ink-3">
        Client
        <select
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            // Picking a client clears the prospective fallback so the
            // server doesn't see both.
            if (e.target.value) setProspective('');
          }}
          className="mt-1 flex h-8 w-full rounded-md border border-line bg-surface-elev px-2 text-xs text-ink"
        >
          <option value="">— or type a prospective name below —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.legalName}
            </option>
          ))}
        </select>
      </label>
      {!clientId && (
        <label className="block text-[10px] text-ink-3">
          Prospective name
          <input
            type="text"
            value={prospective}
            onChange={(e) => setProspective(e.target.value)}
            placeholder="Acme Health Pty Ltd"
            className="mt-1 flex h-8 w-full rounded-md border border-line bg-surface-elev px-2 text-xs text-ink"
          />
        </label>
      )}
      <label className="block text-[10px] text-ink-3">
        Prospective project detail
        <textarea
          value={projectDetail}
          onChange={(e) => setProjectDetail(e.target.value)}
          rows={2}
          placeholder="What the work is about — scope, key questions, deliverables."
          className="mt-1 flex w-full rounded-md border border-line bg-surface-elev px-2 py-1 text-xs text-ink"
        />
      </label>
      {error && <p className="text-[10px] text-status-red">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={reset}
          disabled={pending}
          className="rounded-md px-2 py-1 text-[11px] text-ink-3 hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-brand px-2 py-1 text-[11px] font-medium text-brand-ink hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Add deal'}
        </button>
      </div>
    </div>
  );
}

function KanbanCard({
  card,
  canMove,
  commercialsVisible,
  reorderable,
  insertionPos,
  onCardDragOver,
}: {
  card: KanbanDeal;
  canMove: boolean;
  commercialsVisible: boolean;
  /** True when this column allows within-column priority ranking. */
  reorderable: boolean;
  /** When non-null, render the insertion indicator line above
   *  (`before`) or below (`after`) this card. */
  insertionPos: 'before' | 'after' | null;
  /** Fired on dragover while the cursor is over THIS card. */
  onCardDragOver: (targetId: string, pos: 'before' | 'after') => void;
}) {
  const last = card.daysSinceLastConversation;
  const lastTone =
    last === null
      ? 'text-ink-4'
      : last > 30
        ? 'text-status-amber'
        : 'text-ink-3';
  return (
    <div className="relative">
      {insertionPos === 'before' && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-1 h-0.5 rounded-full bg-brand"
        />
      )}
      {insertionPos === 'after' && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-1 h-0.5 rounded-full bg-brand"
        />
      )}
    <div
      draggable={canMove && !card.archivedAt}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/deal-id', card.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (!reorderable || card.archivedAt) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pos: 'before' | 'after' =
          e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
        e.preventDefault();
        e.stopPropagation();
        onCardDragOver(card.id, pos);
      }}
      className={`group rounded-lg border border-line bg-card p-3 shadow-sm transition-shadow ${
        canMove && !card.archivedAt
          ? 'cursor-grab active:cursor-grabbing hover:shadow-md hover:border-brand'
          : ''
      } ${card.archivedAt ? 'opacity-60' : ''}`}
      title={
        card.archivedAt
          ? 'Archived deals are read-only'
          : reorderable
            ? 'Drag within the column to rank · drag between columns to change stage'
            : canMove
              ? 'Drag to another column to change stage'
              : undefined
      }
    >
      <div className="flex items-start justify-between">
        <Link
          href={`/bd/${card.id}`}
          className="font-mono text-[10px] text-ink-3 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {card.code}
        </Link>
        <span className="text-[10px] tabular-nums text-ink-3">
          {card.probabilityPct}%
        </span>
      </div>
      <Link
        href={`/bd/${card.id}`}
        className="mt-1 block text-sm font-semibold text-ink line-clamp-2 hover:underline"
      >
        {card.name}
      </Link>
      {card.clientLabel && (
        <div className="mt-0.5 truncate text-[11px] text-ink-3">
          {card.clientLabel}
        </div>
      )}
      {(card.clientType || card.engagementType) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.clientType && (
            <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
              {prettyEnum(card.clientType)}
            </span>
          )}
          {card.engagementType && (
            <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
              {prettyEnum(card.engagementType)}
            </span>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between">
        {commercialsVisible ? (
          <span className="font-semibold tabular-nums text-ink">
            {formatMoney(card.expectedValueCents)}
          </span>
        ) : (
          <span aria-hidden />
        )}
        <div className="flex items-center gap-1.5 text-[11px]">
          <PersonAvatar
  className="h-5 w-5"
  fallbackClassName="text-[9px]"
  initials={card.owner.initials}
  headshotUrl={card.owner.headshotUrl}
/>
          <span className={`tabular-nums ${lastTone}`}>
            {last === null ? '—' : last === 0 ? 'today' : `${last}d`}
          </span>
        </div>
      </div>
    </div>
    </div>
  );
}
