'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition, useCallback } from 'react';
import type { RecruitTargetBand, RecruitStatus } from '@prisma/client';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { moveRecruit, type MoveRecruitState } from './actions';
import { KanbanQuickAdd, type QuickAddOwner } from './kanban-quick-add';

/**
 * Talent kanban — drag-and-drop column-per-stage view. Mirrors the
 * Projects kanban's HTML5 drag-drop + useOptimistic pattern so the
 * interaction model is consistent across the two boards.
 *
 * Columns left-to-right (funnel order): Screening · In Discussion ·
 * Offer · Nixed.  Each card shows its target band as a chip so the
 * band context isn't lost when the board groups by stage.
 *
 * Dropping a card into:
 *   - Screening / In Discussion / Offer → sets stage to that canonical
 *     value and (if previously nixed) restores status to active.
 *   - Nixed → flips status to nixed (and stamps closedAt server-side).
 */

export type TalentKanbanCard = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  location: string | null;
  targetBand: RecruitTargetBand;
  bandLabel: string;
  status: RecruitStatus;
  stage: string | null;
  source: string | null;
  daysInPipeline: number;
  owner: { initials: string; headshotUrl: string | null };
  referredBy: { firstName: string; lastName: string } | null;
  closedAtIso: string | null;
};

type StageColumn = 'screening' | 'in_discussion' | 'offer' | 'nixed';

const STAGE_LABEL: Record<StageColumn, string> = {
  screening: 'Screening',
  in_discussion: 'In Discussion',
  offer: 'Offer',
  nixed: 'Nixed',
};

const STAGE_HINT: Record<StageColumn, string> = {
  screening: 'sourced · not yet engaged',
  in_discussion: 'interviewing · referencing',
  offer: 'offer extended · negotiating',
  nixed: 'passed · withdrew · not a fit',
};

const STAGE_ORDER: readonly StageColumn[] = [
  'screening',
  'in_discussion',
  'offer',
  'nixed',
];

/**
 * Bucket a card into one of the four columns. status='nixed' wins.
 * Otherwise keyword-match the free-form stage string — `offer/accept/
 * sign` → offer, `interview/discuss/meeting/chat/call/reference` →
 * in_discussion, everything else (null, "lead", "screening") →
 * screening.
 */
export function bucketCard(card: TalentKanbanCard): StageColumn {
  if (card.status === 'nixed') return 'nixed';
  const stage = (card.stage ?? '').toLowerCase();
  if (/offer|accept|sign/.test(stage)) return 'offer';
  if (/interview|discuss|meeting|chat|call|reference/.test(stage))
    return 'in_discussion';
  return 'screening';
}

type OptimisticPatch = { id: string; toStage: StageColumn };

export function TalentKanban({
  cards,
  canMove,
  canCreate,
  owners,
  defaultOwnerId,
}: {
  cards: TalentKanbanCard[];
  canMove: boolean;
  /** Whether the viewer can create prospects. Hides the inline
   *  quick-add when false. */
  canCreate: boolean;
  /** Active people available as FH responsible contacts on the
   *  inline quick-add. Server passes the full active roster. */
  owners: QuickAddOwner[];
  /** Default owner pre-selected on the picker — the logged-in admin. */
  defaultOwnerId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [optimisticCards, dispatch] = useOptimistic<
    TalentKanbanCard[],
    OptimisticPatch
  >(cards, (current, action) =>
    current.map((c) =>
      c.id === action.id
        ? {
            ...c,
            stage: action.toStage === 'nixed' ? c.stage : action.toStage,
            status: action.toStage === 'nixed' ? 'nixed' : 'active',
          }
        : c,
    ),
  );

  const handleDrop = useCallback(
    (cardId: string, toColumn: StageColumn) => {
      const card = cards.find((c) => c.id === cardId);
      if (!card) return;
      if (bucketCard(card) === toColumn) return; // already there
      setError(null);
      const fd = new FormData();
      fd.set('id', cardId);
      if (toColumn === 'nixed') {
        fd.set('status', 'nixed');
      } else {
        // Always re-set to active so a drag out of Nixed restores it.
        fd.set('status', 'active');
        fd.set('stage', toColumn);
      }
      startTransition(async () => {
        dispatch({ id: cardId, toStage: toColumn });
        const result = (await moveRecruit({ status: 'idle' }, fd)) as MoveRecruitState;
        if (result.status === 'error') {
          setError(result.message);
        }
        router.refresh();
      });
    },
    [cards, dispatch, router],
  );

  // Build per-column buckets from the optimistic cards.
  const grouped: Record<StageColumn, TalentKanbanCard[]> = {
    screening: [],
    in_discussion: [],
    offer: [],
    nixed: [],
  };
  for (const c of optimisticCards) grouped[bucketCard(c)].push(c);

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {error}
        </div>
      )}
      {pending && <div className="text-xs text-ink-3">Saving move…</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {STAGE_ORDER.map((stage) => (
          <KanbanColumn
            key={stage}
            stage={stage}
            cards={grouped[stage]}
            canMove={canMove}
            onDrop={handleDrop}
            // Inline quick-add only on Screening — new prospects
            // always start there.
            quickAdd={
              stage === 'screening' && canCreate
                ? { owners, defaultOwnerId }
                : null
            }
          />
        ))}
      </div>
    </div>
  );
}

function KanbanColumn({
  stage,
  cards,
  canMove,
  onDrop,
  quickAdd,
}: {
  stage: StageColumn;
  cards: TalentKanbanCard[];
  canMove: boolean;
  onDrop: (cardId: string, toStage: StageColumn) => void;
  quickAdd: { owners: QuickAddOwner[]; defaultOwnerId: string } | null;
}) {
  const [hovering, setHovering] = useState(false);
  const isNixed = stage === 'nixed';
  const dotColor =
    stage === 'offer'
      ? 'bg-status-green'
      : stage === 'in_discussion'
        ? 'bg-status-amber'
        : isNixed
          ? 'bg-line'
          : 'bg-status-green';
  return (
    <div
      onDragOver={(e) => {
        if (!canMove) return;
        e.preventDefault();
        setHovering(true);
      }}
      onDragLeave={() => setHovering(false)}
      onDrop={(e) => {
        if (!canMove) return;
        e.preventDefault();
        setHovering(false);
        const cardId = e.dataTransfer.getData('text/recruit-id');
        if (cardId) onDrop(cardId, stage);
      }}
      className={`rounded-xl border bg-surface-subtle/40 p-3 transition-colors ${
        hovering ? 'border-brand bg-surface-hover/40' : 'border-line'
      } ${isNixed ? 'bg-surface-subtle/20' : ''}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
          <span className="text-sm font-semibold text-ink">{STAGE_LABEL[stage]}</span>
          <span className="text-xs tabular-nums text-ink-3">{cards.length}</span>
        </div>
        <span className="text-[11px] text-ink-3">{STAGE_HINT[stage]}</span>
      </div>
      <div className="space-y-3">
        {cards.length === 0 && (
          <div className="rounded-lg border border-dashed border-line p-6 text-center text-xs text-ink-4">
            {isNixed ? 'No nixed prospects.' : 'No prospects at this stage.'}
          </div>
        )}
        {cards.map((card) => (
          <KanbanCard key={card.id} card={card} canMove={canMove} />
        ))}
        {quickAdd && (
          <KanbanQuickAdd
            owners={quickAdd.owners}
            defaultOwnerId={quickAdd.defaultOwnerId}
          />
        )}
      </div>
    </div>
  );
}

function KanbanCard({
  card,
  canMove,
}: {
  card: TalentKanbanCard;
  canMove: boolean;
}) {
  const ageTone =
    card.daysInPipeline > 42
      ? 'text-status-red'
      : card.daysInPipeline > 14
        ? 'text-status-amber'
        : 'text-ink-3';
  const nixed = card.status === 'nixed';
  return (
    <div
      draggable={canMove}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/recruit-id', card.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`group rounded-lg border border-line bg-card p-4 shadow-sm transition-shadow ${
        canMove ? 'cursor-grab active:cursor-grabbing hover:shadow-md' : ''
      } ${nixed ? 'opacity-70' : ''}`}
      title={canMove ? 'Drag to another column to change stage' : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/talent/${card.id}`}
          className="block min-w-0 flex-1 hover:underline"
        >
          <div className="truncate text-sm font-semibold text-ink">
            {card.firstName} {card.lastName}
          </div>
          {card.location && (
            <div className="truncate text-xs text-ink-3">{card.location}</div>
          )}
        </Link>
        <PersonAvatar
          className="h-6 w-6 shrink-0"
          fallbackClassName="text-[10px]"
          initials={card.owner.initials}
          headshotUrl={card.owner.headshotUrl}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[10px]">
          {card.bandLabel}
        </Badge>
        {card.source && (
          <span className="truncate text-[11px] text-ink-3">via {card.source}</span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className={`tabular-nums ${ageTone}`}>
          {nixed && card.closedAtIso
            ? `nixed ${new Date(card.closedAtIso).toLocaleDateString('en-AU')}`
            : `${card.daysInPipeline}d in pipeline`}
        </span>
        {card.referredBy && (
          <span className="truncate text-ink-3">
            ref · {card.referredBy.firstName} {card.referredBy.lastName[0]}.
          </span>
        )}
      </div>
    </div>
  );
}
