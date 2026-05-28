import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { RecruitTargetBand } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import {
  getRecruitBoard,
  type RecruitCard,
} from '@/server/recruits';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QuickAddInColumn } from './quick-add';

/**
 * Recruitment pipeline — kanban tracker for prospective hires. Super-
 * admin only. Mirrors the BD pipeline visual language (columns = pools,
 * cards = candidates) but cards are people-shaped rather than deal-
 * shaped, and the rightmost column is Nixed (passed-on prospects)
 * instead of Won/Lost.
 *
 * Columns left-to-right (most-senior first):
 *   Senior Leaders · Experts · Fellows · Consultants · Analysts · Nixed
 *
 * Read-only kanban for v1 — moves between columns happen on the
 * detail page via the move + status actions. Drag-and-drop comes
 * later if it earns its keep.
 */
export default async function RecruitsPage() {
  const session = await getSession();
  if (!session || !hasCapability(session, 'recruit.manage')) notFound();

  const board = await getRecruitBoard();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Talent pipeline</h1>
          <p className="text-sm text-ink-3">
            Prospective hires by band. {board.totalActive} active ·{' '}
            {board.totalNixed} nixed. Promote a card to a hire from the detail
            page — the new Person record links back so the audit trail keeps the
            full funnel history.
          </p>
        </div>
        <Button asChild>
          <Link href="/talent/new">+ New prospect</Link>
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {board.columns.map((col) => (
          <KanbanColumn key={col.band} band={col.band} label={col.label} cards={col.cards} />
        ))}
        <KanbanColumn
          band={null}
          label="Nixed"
          cards={board.nixed}
          variant="nixed"
        />
      </div>
    </div>
  );
}

function KanbanColumn({
  band,
  label,
  cards,
  variant = 'active',
}: {
  /** The pool the column represents. Null for the Nixed column —
   *  no quick-add affordance there (you don't add directly to
   *  Nixed; you add to a pool and optionally nix later). */
  band: RecruitTargetBand | null;
  label: string;
  cards: RecruitCard[];
  variant?: 'active' | 'nixed';
}) {
  const tone =
    variant === 'nixed'
      ? 'border-line bg-surface-subtle/30'
      : 'border-line bg-card';
  return (
    <Card className={`flex flex-col ${tone}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ink-3">
          {label}
        </CardTitle>
        <Badge variant="outline" className="text-[10px] tabular-nums">
          {cards.length}
        </Badge>
      </CardHeader>
      <CardContent className="flex-1 space-y-2 p-2 pt-0">
        {cards.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-ink-3">
            {variant === 'nixed' ? 'No nixed prospects.' : 'Empty pool.'}
          </p>
        ) : (
          cards.map((c) => <RecruitCardTile key={c.id} card={c} />)
        )}
        {/* Quick-add — bottom of every active column. Skipped on
            Nixed since that column is a destination, not a source. */}
        {band && variant === 'active' && (
          <QuickAddInColumn band={band} bandLabel={label} />
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
        {card.stage && (
          <Badge variant="amber" className="text-[10px]">
            {card.stage}
          </Badge>
        )}
        {card.source && (
          <span className="truncate text-ink-3">via {card.source}</span>
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
