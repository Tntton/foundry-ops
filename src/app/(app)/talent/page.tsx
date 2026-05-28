import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import {
  getRecruitBoard,
  TARGET_BAND_LABELS,
  type RecruitCard,
} from '@/server/recruits';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Recruitment pipeline — kanban tracker for prospective hires. Super-
 * admin only. Funnel-stage columns (left → right):
 *   Screening · In Discussion · Offer · Nixed
 *
 * Target band (analyst / consultant / fellow / expert / senior leader)
 * surfaces as a chip on each card so the band context isn't lost when
 * we group by stage instead of by pool. Reasoning: the active question
 * for leadership is "who's where in the funnel", and bands cluster
 * predictably anyway (most cards are consultant/expert).
 *
 * Stage categorisation is forgiving — `stage` is a free-form string
 * on the model, so we bucket on keyword match. Anything that doesn't
 * match Offer or In Discussion lands in Screening (the default for
 * new prospects).
 *
 * Read-only kanban for v1 — stage / status changes happen on the
 * detail page. Drag-and-drop comes later if it earns its keep.
 */

type StageColumn = 'screening' | 'in_discussion' | 'offer' | 'nixed';

const STAGE_LABELS: Record<StageColumn, string> = {
  screening: 'Screening',
  in_discussion: 'In Discussion',
  offer: 'Offer',
  nixed: 'Nixed',
};

const STAGE_ORDER: readonly StageColumn[] = [
  'screening',
  'in_discussion',
  'offer',
  'nixed',
];

function categorise(card: RecruitCard): StageColumn {
  if (card.status === 'nixed') return 'nixed';
  const stage = (card.stage ?? '').toLowerCase();
  if (/offer|accept|sign/.test(stage)) return 'offer';
  if (/interview|discuss|meeting|chat|call|reference/.test(stage))
    return 'in_discussion';
  // Default for null / "lead" / "screening" / "initial" / etc.
  return 'screening';
}

export default async function RecruitsPage() {
  const session = await getSession();
  if (!session || !hasCapability(session, 'recruit.manage')) notFound();

  const board = await getRecruitBoard();

  // Flatten + categorise. The server still returns band-grouped + nixed
  // separately, but for this view we re-bucket by stage.
  const buckets: Record<StageColumn, RecruitCard[]> = {
    screening: [],
    in_discussion: [],
    offer: [],
    nixed: [],
  };
  for (const col of board.columns) {
    for (const c of col.cards) buckets[categorise(c)].push(c);
  }
  for (const c of board.nixed) buckets.nixed.push(c);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Talent pipeline</h1>
          <p className="text-sm text-ink-3">
            Prospects by funnel stage. {board.totalActive} active ·{' '}
            {board.totalNixed} nixed. Band shown on each card as a chip. Move
            cards between stages from the detail page.
          </p>
        </div>
        <Button asChild>
          <Link href="/talent/new">+ New prospect</Link>
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {STAGE_ORDER.map((stage) => (
          <KanbanColumn
            key={stage}
            stage={stage}
            cards={buckets[stage]}
          />
        ))}
      </div>
    </div>
  );
}

function KanbanColumn({
  stage,
  cards,
}: {
  stage: StageColumn;
  cards: RecruitCard[];
}) {
  const isNixed = stage === 'nixed';
  const tone = isNixed
    ? 'border-line bg-surface-subtle/30'
    : 'border-line bg-card';
  return (
    <Card className={`flex flex-col ${tone}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ink-3">
          {STAGE_LABELS[stage]}
        </CardTitle>
        <Badge variant="outline" className="text-[10px] tabular-nums">
          {cards.length}
        </Badge>
      </CardHeader>
      <CardContent className="flex-1 space-y-2 p-2 pt-0">
        {cards.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-ink-3">
            {isNixed ? 'No nixed prospects.' : 'No prospects at this stage.'}
          </p>
        ) : (
          cards.map((c) => <RecruitCardTile key={c.id} card={c} />)
        )}
      </CardContent>
    </Card>
  );
}

function RecruitCardTile({ card }: { card: RecruitCard }) {
  // Days-in-pipeline tone: green ≤ 14d (fresh), amber 15-42d (warming),
  // red > 42d (stalled — admin should chase or nix).
  const ageTone =
    card.daysInPipeline > 42
      ? 'text-status-red'
      : card.daysInPipeline > 14
        ? 'text-status-amber'
        : 'text-ink-3';
  const nixed = card.status === 'nixed';
  return (
    <Link
      href={`/talent/${card.id}`}
      className={`block rounded-md border px-3 py-2 transition-colors hover:border-brand hover:bg-surface-hover ${
        nixed ? 'border-line bg-surface-subtle/50 opacity-70' : 'border-line bg-surface-elev'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">
            {card.firstName} {card.lastName}
          </div>
          {card.location && (
            <div className="truncate text-[11px] text-ink-3">{card.location}</div>
          )}
        </div>
        <PersonAvatar
          className="h-5 w-5"
          fallbackClassName="text-[9px]"
          initials={card.owner.initials}
          headshotUrl={card.owner.headshotUrl}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
        <Badge variant="outline" className="text-[10px]">
          {TARGET_BAND_LABELS[card.targetBand]}
        </Badge>
        {card.stage && (
          <span className="truncate text-ink-3">{card.stage}</span>
        )}
        {card.source && (
          <span className="truncate text-ink-3">· via {card.source}</span>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px]">
        <span className={`tabular-nums ${ageTone}`}>
          {nixed && card.closedAt
            ? `nixed ${card.closedAt.toLocaleDateString('en-AU')}`
            : `${card.daysInPipeline}d in pipeline`}
        </span>
        {card.referredBy && (
          <span className="text-ink-3">
            ref · {card.referredBy.firstName} {card.referredBy.lastName[0]}.
          </span>
        )}
      </div>
    </Link>
  );
}
