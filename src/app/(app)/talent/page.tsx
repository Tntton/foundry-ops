import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { RecruitTargetBand } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import {
  getRecruitBoard,
  TARGET_BAND_LABELS,
  TARGET_BAND_ORDER,
  type RecruitCard,
} from '@/server/recruits';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/**
 * Recruitment pipeline — kanban tracker for prospective hires. Super-
 * admin only. Matrix layout:
 *   rows    → target band (Analysts → Senior Leaders, most-junior first)
 *   columns → funnel stage (Screening · In Discussion · Offer · Nixed)
 *
 * Each cell holds the cards at that (band, stage) intersection. Empty
 * cells render a faint dash so the grid stays scannable. Stage
 * categorisation is forgiving keyword-match against the free-form
 * `stage` string on the model.
 *
 * Why this shape: leadership wants two questions answered at once —
 * "what does the funnel look like" (stage columns) and "what band of
 * person is at each stage" (band rows). A matrix shows both in one
 * glance without requiring filters.
 *
 * Read-only kanban for v1 — stage / band moves happen on the detail
 * page. Drag-and-drop comes later if it earns its keep.
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

// Band rows top-to-bottom — most-junior first so eye travel goes from
// "lots of analysts" (typically) up the seniority ladder. Mirror of
// TARGET_BAND_ORDER which is most-senior-first for the column layout.
const BAND_ROW_ORDER: readonly RecruitTargetBand[] = [
  ...TARGET_BAND_ORDER,
].reverse() as readonly RecruitTargetBand[];

function categorise(card: RecruitCard): StageColumn {
  if (card.status === 'nixed') return 'nixed';
  const stage = (card.stage ?? '').toLowerCase();
  if (/offer|accept|sign/.test(stage)) return 'offer';
  if (/interview|discuss|meeting|chat|call|reference/.test(stage))
    return 'in_discussion';
  return 'screening';
}

export default async function RecruitsPage() {
  const session = await getSession();
  if (!session || !hasCapability(session, 'recruit.manage')) notFound();

  const board = await getRecruitBoard();

  // Build the (band, stage) matrix. Initialise every cell so empty
  // cells render predictably.
  const matrix = {} as Record<RecruitTargetBand, Record<StageColumn, RecruitCard[]>>;
  for (const b of BAND_ROW_ORDER) {
    matrix[b] = { screening: [], in_discussion: [], offer: [], nixed: [] };
  }

  for (const col of board.columns) {
    for (const c of col.cards) {
      matrix[c.targetBand][categorise(c)].push(c);
    }
  }
  for (const c of board.nixed) {
    matrix[c.targetBand].nixed.push(c);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Talent pipeline</h1>
          <p className="text-sm text-ink-3">
            Prospects by band × funnel stage. {board.totalActive} active ·{' '}
            {board.totalNixed} nixed. Move cards between stages from the
            detail page.
          </p>
        </div>
        <Button asChild>
          <Link href="/talent/new">+ New prospect</Link>
        </Button>
      </header>

      <div className="overflow-x-auto rounded-md border border-line bg-card">
        <div
          className="grid min-w-[920px] gap-px bg-line"
          style={{
            gridTemplateColumns: '160px repeat(4, minmax(180px, 1fr))',
          }}
        >
          {/* Header row — empty corner + 4 stage labels */}
          <div className="bg-surface-subtle" />
          {STAGE_ORDER.map((stage) => (
            <div
              key={stage}
              className="bg-surface-subtle px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-3"
            >
              {STAGE_LABELS[stage]}
            </div>
          ))}

          {/* Body — one row per band */}
          {BAND_ROW_ORDER.map((band) => (
            <Row
              key={band}
              band={band}
              cellsByStage={matrix[band]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({
  band,
  cellsByStage,
}: {
  band: RecruitTargetBand;
  cellsByStage: Record<StageColumn, RecruitCard[]>;
}) {
  const total = STAGE_ORDER.reduce(
    (s, stage) => s + cellsByStage[stage].length,
    0,
  );
  return (
    <>
      {/* Band label cell — sticky left so it stays visible on h-scroll */}
      <div className="sticky left-0 z-10 flex items-start justify-between gap-2 bg-card px-3 py-2">
        <div className="text-xs font-semibold text-ink">
          {TARGET_BAND_LABELS[band]}
        </div>
        <Badge variant="outline" className="text-[10px] tabular-nums">
          {total}
        </Badge>
      </div>
      {STAGE_ORDER.map((stage) => (
        <Cell
          key={stage}
          stage={stage}
          cards={cellsByStage[stage]}
        />
      ))}
    </>
  );
}

function Cell({ stage, cards }: { stage: StageColumn; cards: RecruitCard[] }) {
  const isNixed = stage === 'nixed';
  return (
    <div
      className={`space-y-2 p-2 ${
        isNixed ? 'bg-surface-subtle/30' : 'bg-card'
      }`}
    >
      {cards.length === 0 ? (
        <div className="px-1 py-2 text-center text-[11px] text-ink-3/60">
          —
        </div>
      ) : (
        cards.map((c) => <RecruitCardTile key={c.id} card={c} />)
      )}
    </div>
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
      className={`block rounded-md border px-2 py-1.5 transition-colors hover:border-brand hover:bg-surface-hover ${
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
      <div className="mt-1 flex items-center justify-between text-[10px]">
        <span className={`tabular-nums ${ageTone}`}>
          {nixed && card.closedAt
            ? `nixed ${card.closedAt.toLocaleDateString('en-AU')}`
            : `${card.daysInPipeline}d`}
        </span>
        {card.referredBy && (
          <span className="truncate text-ink-3">
            ref · {card.referredBy.firstName} {card.referredBy.lastName[0]}.
          </span>
        )}
      </div>
    </Link>
  );
}
