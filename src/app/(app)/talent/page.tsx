import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import {
  getRecruitBoard,
  TARGET_BAND_LABELS,
  type RecruitCard,
} from '@/server/recruits';
import { Button } from '@/components/ui/button';
import { TalentKanban, type TalentKanbanCard } from './kanban';

/**
 * Recruitment pipeline — kanban tracker for prospective hires. Super-
 * admin only. Same shape as the Projects kanban: four vertical
 * columns (Screening · In Discussion · Offer · Nixed) with drag-drop
 * to move cards between stages.
 *
 * Target band (Analyst → Senior Leader) surfaces as a chip on each
 * card so the band context isn't lost when grouping by stage.
 */
export default async function RecruitsPage() {
  const session = await getSession();
  if (!session || !hasCapability(session, 'recruit.manage')) notFound();

  const board = await getRecruitBoard();

  // Flatten the server-shape (band-grouped + nixed list) into the flat
  // card list the client kanban expects. The client component handles
  // bucketing into columns.
  const all: RecruitCard[] = [
    ...board.columns.flatMap((col) => col.cards),
    ...board.nixed,
  ];
  const cards: TalentKanbanCard[] = all.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    location: c.location,
    targetBand: c.targetBand,
    bandLabel: TARGET_BAND_LABELS[c.targetBand],
    status: c.status,
    stage: c.stage,
    source: c.source,
    daysInPipeline: c.daysInPipeline,
    owner: {
      initials: c.owner.initials,
      headshotUrl: c.owner.headshotUrl,
    },
    referredBy: c.referredBy
      ? { firstName: c.referredBy.firstName, lastName: c.referredBy.lastName }
      : null,
    closedAtIso: c.closedAt ? c.closedAt.toISOString() : null,
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Talent pipeline</h1>
          <p className="text-sm text-ink-3">
            Prospects by funnel stage. {board.totalActive} active ·{' '}
            {board.totalNixed} nixed. Drag a card to a new column to update
            its stage; band shown as a chip on each card.
          </p>
        </div>
        <Button asChild>
          <Link href="/talent/new">+ New prospect</Link>
        </Button>
      </header>

      <TalentKanban cards={cards} canMove={true} />
    </div>
  );
}
