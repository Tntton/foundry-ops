'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useOptimistic, useState, useTransition, useCallback } from 'react';
import type { DealStage } from '@prisma/client';
import { PersonAvatar } from '@/components/person-avatar';
import {
  moveDeal,
  quickCreateDeal,
  type MoveDealState,
  type QuickCreateState,
} from './actions';

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
};

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
    { id: string; toStage: DealStage }
  >(deals, (current, action) =>
    current.map((d) =>
      d.id === action.id ? { ...d, stage: action.toStage } : d,
    ),
  );

  const handleDrop = useCallback(
    (dealId: string, toStage: DealStage) => {
      const deal = deals.find((d) => d.id === dealId);
      if (!deal || deal.stage === toStage) return;
      setError(null);
      const fd = new FormData();
      fd.set('dealId', dealId);
      fd.set('toStage', toStage);
      startTransition(async () => {
        dispatch({ id: dealId, toStage });
        const result = (await moveDeal({ status: 'idle' }, fd)) as MoveDealState;
        if (result.status === 'error') {
          setError(result.message);
        }
        router.refresh();
      });
    },
    [deals, dispatch, router],
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
  quickCreateOwners: QuickCreateOwner[];
  quickCreateClients: QuickCreateClient[];
  defaultOwnerId: string | null;
  commercialsVisible: boolean;
}) {
  const [hovering, setHovering] = useState(false);
  const expected = cards.reduce((s, d) => s + d.expectedValueCents, 0);
  const weighted = cards.reduce((s, d) => s + d.weightedValueCents, 0);
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
        const dealId = e.dataTransfer.getData('text/deal-id');
        setHovering(false);
        if (dealId) onDrop(dealId, stage);
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
}: {
  card: KanbanDeal;
  canMove: boolean;
  commercialsVisible: boolean;
}) {
  const last = card.daysSinceLastConversation;
  const lastTone =
    last === null
      ? 'text-ink-4'
      : last > 30
        ? 'text-status-amber'
        : 'text-ink-3';
  return (
    <div
      draggable={canMove && !card.archivedAt}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/deal-id', card.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`group rounded-lg border border-line bg-card p-3 shadow-sm transition-shadow ${
        canMove && !card.archivedAt
          ? 'cursor-grab active:cursor-grabbing hover:shadow-md hover:border-brand'
          : ''
      } ${card.archivedAt ? 'opacity-60' : ''}`}
      title={
        card.archivedAt
          ? 'Archived deals are read-only'
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
  );
}
