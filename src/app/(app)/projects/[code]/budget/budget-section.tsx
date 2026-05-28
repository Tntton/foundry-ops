'use client';

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import {
  saveProjectBudget,
  initialiseProjectBudget,
  type BudgetSaveState,
} from './actions';
import { Button } from '@/components/ui/button';

/**
 * Project finance tracker — Excel-like cell-managed editor.
 *
 * All numeric inputs are tracked by (row, col) coordinate. Tab / Shift-
 * Tab navigates horizontally across cells, Enter moves down, arrow keys
 * jump in any direction. Totals recompute on every keystroke so the
 * cascade (project expense total → net costs → net revenue → LT share)
 * stays live, the same way it would in a spreadsheet.
 *
 * The form persists via a single `saveProjectBudget` server action; lines
 * are kept by stable id so re-saving doesn't churn audit history.
 */

type Category =
  | 'partner_lt'
  | 'manager'
  | 'consultant'
  | 'analyst'
  | 'expert_paid'
  | 'project_resources'
  | 'travel'
  | 'meals'
  | 'other';

const CATEGORY_LABEL: Record<Category, string> = {
  partner_lt: 'Leadership team',
  manager: 'Manager',
  consultant: 'Consultant',
  analyst: 'Analyst',
  expert_paid: 'Expert (paid)',
  project_resources: 'Project resources',
  travel: 'Travel',
  meals: 'Meals',
  other: 'Other',
};

export type BudgetLineInput = {
  id: string | null; // null for unsaved rows
  category: Category;
  description: string;
  rateCents: number;
  unitsPerWeek: number;
  weeks: number;
  comment: string | null;
  forecastCents: number;
  actualCents: number;
  variancePct: number | null;
};

export type BudgetMetaInput = {
  numberOfWeeks: number;
  totalFeeCents: number;
  opexContributionPct: number;
  bdReferralPct: number;
  bdReferralCapCents: number;
  firmProfitPoolPct: number;
  ltShareCount: number;
  notes: string | null;
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatDollars(cents: number): string {
  // For input fields — plain dollars without currency symbol so users
  // can edit freely.
  return (cents / 100).toFixed(0);
}

function newLine(category: Category, weeks: number): BudgetLineInput {
  return {
    id: null,
    category,
    description: CATEGORY_LABEL[category],
    rateCents: 0,
    unitsPerWeek: 0,
    weeks,
    comment: null,
    forecastCents: 0,
    actualCents: 0,
    variancePct: null,
  };
}

function lineForecast(line: BudgetLineInput): number {
  return Math.round(line.rateCents * line.unitsPerWeek * line.weeks);
}

// ─── Excel-like cell coordinator ──────────────────────────────────
// Numeric edit cells get a stable string key; we route Tab/Enter/arrows
// across the registered keys in row-major order.

type CellKey = string;

function makeCellKey(row: number, col: number): CellKey {
  return `r${row}c${col}`;
}

const COLS_PER_LINE = 4; // description, rate, units/wk, weeks (Total + Variance read-only)

export function ProjectBudgetSection({
  projectId,
  hasBudget,
  meta: initialMeta,
  lines: initialLines,
  totalsActualCents,
  canEdit,
  primaryPartnerName,
}: {
  projectId: string;
  hasBudget: boolean;
  meta: BudgetMetaInput;
  lines: BudgetLineInput[];
  totalsActualCents: number;
  canEdit: boolean;
  primaryPartnerName: string;
}) {
  const [meta, setMeta] = useState(initialMeta);
  const [lines, setLines] = useState(initialLines);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<BudgetSaveState>({ status: 'idle' });
  const [initPending, startInit] = useTransition();

  // Cell ref registry — populated by inputs on mount via the
  // `registerCell` callback, used by keyboard navigation to focus
  // siblings.
  const cellsRef = useRef<Map<CellKey, HTMLInputElement>>(new Map());
  const registerCell = useCallback(
    (key: CellKey) => (el: HTMLInputElement | null) => {
      const map = cellsRef.current;
      if (el) map.set(key, el);
      else map.delete(key);
    },
    [],
  );

  function focusCell(row: number, col: number): boolean {
    const totalCols = COLS_PER_LINE;
    const totalRows = lines.length;
    if (row < 0 || row >= totalRows) return false;
    if (col < 0 || col >= totalCols) return false;
    const el = cellsRef.current.get(makeCellKey(row, col));
    if (!el) return false;
    el.focus();
    el.select();
    return true;
  }

  function handleCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    row: number,
    col: number,
  ) {
    const totalCols = COLS_PER_LINE;
    const totalRows = lines.length;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        // Prev cell — wrap from col 0 to last col of prev row.
        if (col > 0) focusCell(row, col - 1);
        else if (row > 0) focusCell(row - 1, totalCols - 1);
      } else {
        if (col < totalCols - 1) focusCell(row, col + 1);
        else if (row < totalRows - 1) focusCell(row + 1, 0);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        if (row > 0) focusCell(row - 1, col);
      } else if (row < totalRows - 1) {
        focusCell(row + 1, col);
      }
    } else if (e.key === 'ArrowDown') {
      if (row < totalRows - 1) {
        e.preventDefault();
        focusCell(row + 1, col);
      }
    } else if (e.key === 'ArrowUp') {
      if (row > 0) {
        e.preventDefault();
        focusCell(row - 1, col);
      }
    } else if (e.key === 'Escape') {
      e.currentTarget.blur();
    }
  }

  function updateLine(idx: number, patch: Partial<BudgetLineInput>) {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)),
    );
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function addLine(category: Category) {
    setLines((prev) => [...prev, newLine(category, meta.numberOfWeeks)]);
  }

  // Live-recomputed totals so the cascade tracks every keystroke.
  const totals = useMemo(() => {
    const fee = meta.totalFeeCents;
    const opex = Math.round((fee * meta.opexContributionPct) / 100);
    const bdRaw = Math.round((fee * meta.bdReferralPct) / 100);
    const bd = Math.min(bdRaw, meta.bdReferralCapCents);
    const bdCapped = bdRaw > meta.bdReferralCapCents;
    const projectExpense = lines.reduce((s, l) => s + lineForecast(l), 0);
    const netCosts = opex + bd + projectExpense;
    const netRevenue = fee - netCosts;
    const profitPool = Math.round((fee * meta.firmProfitPoolPct) / 100);
    const ltShare = netRevenue - profitPool;
    return {
      fee,
      opex,
      bd,
      bdCapped,
      projectExpense,
      netCosts,
      netRevenue,
      profitPool,
      ltShare,
      projectExpensePct: fee > 0 ? (projectExpense / fee) * 100 : 0,
      netRevenuePct: fee > 0 ? (netRevenue / fee) * 100 : 0,
      ltSharePct: fee > 0 ? (ltShare / fee) * 100 : 0,
    };
  }, [meta, lines]);

  // AP take-home estimate — sums the AP's BD referral (only when
  // bdReferralPct > 0; partners get 0 per governance), their LT day-rate
  // hours from the partner_lt line (assumes equal split across LTs), and
  // their share of LT residual (1 / ltShareCount).
  const apTakeHome = useMemo(() => {
    const partnerLine = lines.find((l) => l.category === 'partner_lt');
    const apHours =
      partnerLine && meta.ltShareCount > 0
        ? lineForecast(partnerLine) / meta.ltShareCount
        : 0;
    const ltShareEqual =
      meta.ltShareCount > 0
        ? Math.round(totals.ltShare / meta.ltShareCount)
        : 0;
    const bdToAp = totals.bd; // assume AP is the referrer when set
    const total = apHours + ltShareEqual + bdToAp;
    const pctOfFee = totals.fee > 0 ? (total / totals.fee) * 100 : 0;
    return { apHours, ltShareEqual, bdToAp, total, pctOfFee };
  }, [lines, meta.ltShareCount, totals]);

  function save() {
    setState({ status: 'idle' });
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('numberOfWeeks', String(meta.numberOfWeeks));
    fd.set('totalFeeCents', String(meta.totalFeeCents));
    fd.set('opexContributionPct', String(meta.opexContributionPct));
    fd.set('bdReferralPct', String(meta.bdReferralPct));
    fd.set('bdReferralCapCents', String(meta.bdReferralCapCents));
    fd.set('firmProfitPoolPct', String(meta.firmProfitPoolPct));
    fd.set('ltShareCount', String(meta.ltShareCount));
    fd.set('notes', meta.notes ?? '');
    for (const l of lines) {
      fd.append('lineId', l.id ?? '');
      fd.append('lineCategory', l.category);
      fd.append('lineDescription', l.description);
      fd.append('lineRateCents', String(l.rateCents));
      fd.append('lineUnitsPerWeek', String(l.unitsPerWeek));
      fd.append('lineWeeks', String(l.weeks));
      fd.append('lineComment', l.comment ?? '');
    }
    startTransition(async () => {
      const result = await saveProjectBudget(projectId, state, fd);
      setState(result);
    });
  }

  function initialise() {
    startInit(async () => {
      const result = await initialiseProjectBudget(
        projectId,
        { status: 'idle' },
        new FormData(),
      );
      setState(result);
    });
  }

  // ─── Empty-state ──────────────────────────────────────────────
  if (!hasBudget && lines.length === 0) {
    return (
      <div className="space-y-3 rounded-lg border border-line bg-card p-6">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            Project finance tracker
          </h3>
          <p className="mt-1 text-xs text-ink-3">
            Forecast the project budget — rate × units/week × weeks per line
            — and track actuals from timesheets / expenses inline. The
            cascade follows FY26 governance: 20% OPEX, 0–10% BD referral
            (capped at $50k), 15% firm profit pool, residual LT share.
          </p>
        </div>
        {totalsActualCents > 0 && (
          <p className="rounded-md border border-status-amber/40 bg-status-amber-soft/40 px-3 py-2 text-[11px] text-status-amber">
            <strong>{formatMoney(totalsActualCents)}</strong> already booked
            against this project — initialise the budget to see forecast vs
            actual side-by-side.
          </p>
        )}
        {canEdit ? (
          <div>
            <Button type="button" size="sm" onClick={initialise} disabled={initPending}>
              {initPending ? 'Initialising…' : 'Initialise budget'}
            </Button>
            <p className="mt-2 text-[11px] text-ink-3">
              Seeds 8 default lines (Leadership / Manager / Consultant /
              Analyst / Expert / Project resources / Travel / Meals) at the
              prototype rates. Edit inline after.
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-ink-3">
            Project partner / manager / admin can initialise.
          </p>
        )}
        {state.status === 'error' && (
          <p className="text-xs text-status-red">{state.message}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Top bar — fee, weeks, notes ───────────────────────── */}
      <div className="rounded-lg border border-line bg-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Total fee (AUD)">
            <input
              type="number"
              min={0}
              step={1000}
              value={formatDollars(meta.totalFeeCents)}
              onChange={(e) =>
                setMeta((m) => ({
                  ...m,
                  totalFeeCents: Math.round(Number(e.target.value || 0) * 100),
                }))
              }
              disabled={!canEdit}
              className="w-full rounded border border-line bg-surface-elev px-2 py-1 text-sm tabular-nums text-ink focus:border-brand disabled:bg-surface-subtle"
            />
          </Field>
          <Field label="Number of weeks">
            <input
              type="number"
              min={1}
              max={520}
              step={1}
              value={meta.numberOfWeeks}
              onChange={(e) =>
                setMeta((m) => ({
                  ...m,
                  numberOfWeeks: Math.max(1, Number(e.target.value || 0)),
                }))
              }
              disabled={!canEdit}
              className="w-full rounded border border-line bg-surface-elev px-2 py-1 text-sm tabular-nums text-ink focus:border-brand disabled:bg-surface-subtle"
            />
          </Field>
          <Field label="Notes">
            <input
              type="text"
              maxLength={200}
              value={meta.notes ?? ''}
              onChange={(e) =>
                setMeta((m) => ({ ...m, notes: e.target.value }))
              }
              placeholder="Team assumptions, scope notes…"
              disabled={!canEdit}
              className="w-full rounded border border-line bg-surface-elev px-2 py-1 text-sm text-ink focus:border-brand disabled:bg-surface-subtle"
            />
          </Field>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <SmallPctField
            label="OPEX %"
            value={meta.opexContributionPct}
            onChange={(v) =>
              setMeta((m) => ({ ...m, opexContributionPct: v }))
            }
            disabled={!canEdit}
            sub="Fixed 20% per FY26 governance"
          />
          <SmallPctField
            label="BD referral %"
            value={meta.bdReferralPct}
            onChange={(v) => setMeta((m) => ({ ...m, bdReferralPct: v }))}
            disabled={!canEdit}
            sub={`Cap ${formatMoney(meta.bdReferralCapCents)} · 0% if partner`}
          />
          <SmallPctField
            label="Firm profit pool %"
            value={meta.firmProfitPoolPct}
            onChange={(v) =>
              setMeta((m) => ({ ...m, firmProfitPoolPct: v }))
            }
            disabled={!canEdit}
            sub="Fixed 15% per FY26 governance"
          />
          <Field label="LT count (split)">
            <input
              type="number"
              min={1}
              max={20}
              step={1}
              value={meta.ltShareCount}
              onChange={(e) =>
                setMeta((m) => ({
                  ...m,
                  ltShareCount: Math.max(1, Number(e.target.value || 0)),
                }))
              }
              disabled={!canEdit}
              className="w-full rounded border border-line bg-surface-elev px-2 py-1 text-sm tabular-nums text-ink focus:border-brand disabled:bg-surface-subtle"
            />
          </Field>
        </div>
      </div>

      {/* ── Forecast table ────────────────────────────────────── */}
      <div className="rounded-lg border border-line bg-card p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-subtle text-[10px] uppercase tracking-wide text-ink-3">
                <th className="px-3 py-2 text-left">Line / category</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Rate (AUD)</th>
                <th className="px-3 py-2 text-right">Units / wk</th>
                <th className="px-3 py-2 text-right">Weeks</th>
                <th className="px-3 py-2 text-right">Forecast</th>
                <th className="px-3 py-2 text-right">% fee</th>
                <th className="px-3 py-2 text-right">Actual</th>
                <th className="px-3 py-2 text-right">Var</th>
                <th className="px-3 py-2 text-left">Comment</th>
                {canEdit && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {/* Fixed-percentage cascade rows (read-only computed) */}
              <tr className="border-b border-line bg-surface-subtle/30">
                <td className="px-3 py-2 text-xs font-medium text-ink-2">
                  FH OPEX contribution
                </td>
                <td className="px-3 py-2 text-xs text-ink-3" colSpan={3}>
                  {meta.opexContributionPct}% of fee · firm overhead
                </td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums text-ink">
                  {formatMoney(totals.opex)}
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-3">
                  {meta.opexContributionPct}%
                </td>
                <td className="px-3 py-2" colSpan={canEdit ? 4 : 3} />
              </tr>
              <tr className="border-b border-line bg-surface-subtle/30">
                <td className="px-3 py-2 text-xs font-medium text-ink-2">
                  BD referral
                </td>
                <td className="px-3 py-2 text-xs text-ink-3" colSpan={3}>
                  {meta.bdReferralPct}% of fee
                  {totals.bdCapped && (
                    <span className="ml-1 text-status-amber">
                      · capped at {formatMoney(meta.bdReferralCapCents)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums text-ink">
                  {formatMoney(totals.bd)}
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-3">
                  {totals.fee > 0
                    ? `${Math.round((totals.bd / totals.fee) * 100 * 10) / 10}%`
                    : '—'}
                </td>
                <td className="px-3 py-2" colSpan={canEdit ? 4 : 3} />
              </tr>

              {/* Section header for editable project-expense lines */}
              <tr className="border-b border-line bg-surface-subtle">
                <td
                  className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3"
                  colSpan={canEdit ? 11 : 10}
                >
                  Project expenses
                </td>
              </tr>

              {lines.map((l, idx) => {
                const forecast = lineForecast(l);
                const pct =
                  totals.fee > 0
                    ? Math.round((forecast / totals.fee) * 100 * 10) / 10
                    : 0;
                const variancePct =
                  forecast > 0
                    ? Math.round(((l.actualCents - forecast) / forecast) * 100)
                    : null;
                return (
                  <tr key={l.id ?? `new-${idx}`} className="border-b border-line">
                    <td className="px-3 py-1.5">
                      {canEdit ? (
                        <select
                          value={l.category}
                          onChange={(e) =>
                            updateLine(idx, {
                              category: e.target.value as Category,
                            })
                          }
                          className="h-7 w-full rounded border border-line bg-surface-elev px-1 text-xs text-ink focus:border-brand"
                        >
                          {(Object.keys(CATEGORY_LABEL) as Category[]).map(
                            (k) => (
                              <option key={k} value={k}>
                                {CATEGORY_LABEL[k]}
                              </option>
                            ),
                          )}
                        </select>
                      ) : (
                        <span className="text-xs text-ink-2">
                          {CATEGORY_LABEL[l.category]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <CellInput
                        kind="text"
                        innerRef={registerCell(makeCellKey(idx, 0))}
                        onKeyDown={(e) => handleCellKeyDown(e, idx, 0)}
                        value={l.description}
                        onChange={(v) =>
                          updateLine(idx, { description: v as string })
                        }
                        disabled={!canEdit}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <CellInput
                        kind="dollars"
                        innerRef={registerCell(makeCellKey(idx, 1))}
                        onKeyDown={(e) => handleCellKeyDown(e, idx, 1)}
                        value={l.rateCents / 100}
                        onChange={(v) =>
                          updateLine(idx, {
                            rateCents: Math.round((v as number) * 100),
                          })
                        }
                        disabled={!canEdit}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <CellInput
                        kind="decimal"
                        innerRef={registerCell(makeCellKey(idx, 2))}
                        onKeyDown={(e) => handleCellKeyDown(e, idx, 2)}
                        value={l.unitsPerWeek}
                        onChange={(v) =>
                          updateLine(idx, { unitsPerWeek: v as number })
                        }
                        disabled={!canEdit}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <CellInput
                        kind="integer"
                        innerRef={registerCell(makeCellKey(idx, 3))}
                        onKeyDown={(e) => handleCellKeyDown(e, idx, 3)}
                        value={l.weeks}
                        onChange={(v) =>
                          updateLine(idx, { weeks: v as number })
                        }
                        disabled={!canEdit}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-ink">
                      {formatMoney(forecast)}
                    </td>
                    <td className="px-3 py-1.5 text-right text-xs tabular-nums text-ink-3">
                      {pct}%
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                      {l.actualCents > 0 ? formatMoney(l.actualCents) : '—'}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right text-xs tabular-nums ${
                        variancePct === null
                          ? 'text-ink-4'
                          : variancePct > 10
                            ? 'text-status-red'
                            : variancePct < -10
                              ? 'text-status-amber'
                              : 'text-status-green'
                      }`}
                    >
                      {variancePct === null ? '—' : `${variancePct}%`}
                    </td>
                    <td className="px-3 py-1.5">
                      {canEdit ? (
                        <input
                          type="text"
                          maxLength={200}
                          value={l.comment ?? ''}
                          onChange={(e) =>
                            updateLine(idx, { comment: e.target.value })
                          }
                          placeholder="—"
                          className="h-7 w-full rounded border border-line bg-surface-elev px-1.5 text-[11px] text-ink-2 focus:border-brand"
                        />
                      ) : (
                        <span className="text-[11px] text-ink-3">
                          {l.comment || '—'}
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          className="text-[10px] text-ink-3 hover:text-status-red"
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}

              {/* Project expense subtotal */}
              <tr className="border-b border-line bg-surface-subtle/60 font-semibold">
                <td className="px-3 py-2 text-xs text-ink" colSpan={5}>
                  Project Expense Total
                  <span className="ml-2 text-[10px] font-normal text-ink-3">
                    Aim &lt;50%
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">
                  {formatMoney(totals.projectExpense)}
                </td>
                <td
                  className={`px-3 py-2 text-right text-xs tabular-nums ${
                    totals.projectExpensePct > 50
                      ? 'text-status-red'
                      : 'text-ink'
                  }`}
                >
                  {Math.round(totals.projectExpensePct * 10) / 10}%
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                  {formatMoney(totalsActualCents)}
                </td>
                <td className="px-3 py-2" colSpan={canEdit ? 3 : 2} />
              </tr>

              {/* Net costs / net rev / profit pool / LT share */}
              <tr className="border-b border-line">
                <td
                  className="px-3 py-1.5 text-xs font-medium text-ink-2"
                  colSpan={5}
                >
                  Net costs <span className="text-ink-4">(OPEX + BD + project expenses)</span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink">
                  {formatMoney(totals.netCosts)}
                </td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums text-ink-3">
                  {totals.fee > 0
                    ? `${Math.round((totals.netCosts / totals.fee) * 100 * 10) / 10}%`
                    : '—'}
                </td>
                <td className="px-3 py-1.5" colSpan={canEdit ? 4 : 3} />
              </tr>
              <tr className="border-b border-line bg-status-green-soft/40 font-semibold">
                <td className="px-3 py-1.5 text-xs text-ink" colSpan={5}>
                  Net revenue <span className="text-[10px] font-normal text-ink-3">(Aim &gt;30%)</span>
                </td>
                <td
                  className={`px-3 py-1.5 text-right tabular-nums ${
                    totals.netRevenue < 0
                      ? 'text-status-red'
                      : 'text-ink'
                  }`}
                >
                  {formatMoney(totals.netRevenue)}
                </td>
                <td
                  className={`px-3 py-1.5 text-right text-xs tabular-nums ${
                    totals.netRevenuePct < 30
                      ? 'text-status-amber'
                      : 'text-status-green'
                  }`}
                >
                  {Math.round(totals.netRevenuePct * 10) / 10}%
                </td>
                <td className="px-3 py-1.5" colSpan={canEdit ? 4 : 3} />
              </tr>
              <tr className="border-b border-line">
                <td
                  className="px-3 py-1.5 text-xs font-medium text-ink-2"
                  colSpan={5}
                >
                  Firm profit pool <span className="text-ink-4">(15% of fee)</span>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink">
                  {formatMoney(totals.profitPool)}
                </td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums text-ink-3">
                  {meta.firmProfitPoolPct}%
                </td>
                <td className="px-3 py-1.5" colSpan={canEdit ? 4 : 3} />
              </tr>
              <tr className="bg-status-blue-soft/30 font-semibold">
                <td className="px-3 py-2 text-xs text-ink" colSpan={5}>
                  Project LT share{' '}
                  <span className="text-[10px] font-normal text-ink-3">
                    (residual · {meta.ltShareCount}-way default split)
                  </span>
                </td>
                <td
                  className={`px-3 py-2 text-right tabular-nums ${
                    totals.ltShare < 0
                      ? 'text-status-red'
                      : totals.ltSharePct < 5
                        ? 'text-status-amber'
                        : 'text-ink'
                  }`}
                >
                  {formatMoney(totals.ltShare)}
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-3">
                  {Math.round(totals.ltSharePct * 10) / 10}%
                </td>
                <td className="px-3 py-2" colSpan={canEdit ? 4 : 3} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── AP take-home estimate (sidecar style) ──────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-line bg-card p-4">
          <h4 className="text-sm font-semibold text-ink">
            AP take-home estimate
          </h4>
          <p className="text-[11px] text-ink-3">
            Indicative only — assumes <strong>{primaryPartnerName}</strong>{' '}
            as the AP, an equal LT split, and that any BD referral flows
            to them. True-up at period close is via the Profit Pool.
          </p>
          <table className="mt-3 w-full text-sm">
            <tbody>
              <tr>
                <td className="py-1 text-xs text-ink-3">BD referral</td>
                <td className="py-1 text-right tabular-nums text-ink">
                  {formatMoney(apTakeHome.bdToAp)}
                </td>
              </tr>
              <tr>
                <td className="py-1 text-xs text-ink-3">
                  Day-rate share (1 / {meta.ltShareCount} of LT line)
                </td>
                <td className="py-1 text-right tabular-nums text-ink">
                  {formatMoney(apTakeHome.apHours)}
                </td>
              </tr>
              <tr>
                <td className="py-1 text-xs text-ink-3">
                  LT residual share (equal {meta.ltShareCount}-way split)
                </td>
                <td className="py-1 text-right tabular-nums text-ink">
                  {formatMoney(apTakeHome.ltShareEqual)}
                </td>
              </tr>
              <tr className="border-t border-line font-semibold">
                <td className="py-1 text-xs text-ink">AP take-home</td>
                <td className="py-1 text-right tabular-nums text-ink">
                  {formatMoney(apTakeHome.total)}
                </td>
              </tr>
              <tr>
                <td className="py-1 text-[11px] text-ink-3">% of gross fee</td>
                <td className="py-1 text-right text-[11px] tabular-nums text-ink-3">
                  {Math.round(apTakeHome.pctOfFee * 10) / 10}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-line bg-card p-4">
          <h4 className="text-sm font-semibold text-ink">
            Health check vs FY26 governance
          </h4>
          <ul className="mt-2 space-y-1.5 text-xs">
            <CheckRow
              ok={totals.projectExpensePct < 50}
              label={`Project expenses ${
                Math.round(totals.projectExpensePct * 10) / 10
              }%`}
              target="Aim < 50%"
            />
            <CheckRow
              ok={totals.netRevenuePct >= 30}
              label={`Net revenue ${
                Math.round(totals.netRevenuePct * 10) / 10
              }%`}
              target="Aim ≥ 30%"
            />
            <CheckRow
              ok={totals.ltSharePct >= 8}
              label={`LT share ${
                Math.round(totals.ltSharePct * 10) / 10
              }%`}
              target="Aim ~ 10%"
            />
            <CheckRow
              ok={meta.opexContributionPct === 20}
              label={`OPEX ${meta.opexContributionPct}%`}
              target="Fixed 20%"
            />
            <CheckRow
              ok={meta.firmProfitPoolPct === 15}
              label={`Firm profit pool ${meta.firmProfitPoolPct}%`}
              target="Fixed 15%"
            />
          </ul>
        </div>
      </div>

      {/* ── Action bar ────────────────────────────────────────── */}
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-subtle/40 p-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => addLine('other')}
            >
              + Add line
            </Button>
            <span className="text-[11px] text-ink-3">
              Tab moves across · Enter moves down · Esc to leave a cell
            </span>
          </div>
          <div className="flex items-center gap-2">
            {state.status === 'error' && (
              <span className="text-xs text-status-red">{state.message}</span>
            )}
            {state.status === 'success' && (
              <span className="text-xs text-status-green">
                Saved · cascade live with actuals.
              </span>
            )}
            <Button type="button" size="sm" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : 'Save budget'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-ink-3">
      <span className="font-medium uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

function SmallPctField({
  label,
  value,
  onChange,
  disabled,
  sub,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  sub?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-ink-3">
      <span className="font-medium uppercase tracking-wide">{label}</span>
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(100, Number(e.target.value || 0))))}
        disabled={disabled}
        className="w-full rounded border border-line bg-surface-elev px-2 py-1 text-sm tabular-nums text-ink focus:border-brand disabled:bg-surface-subtle"
      />
      {sub && <span className="text-[10px] text-ink-4">{sub}</span>}
    </label>
  );
}

function CheckRow({
  ok,
  label,
  target,
}: {
  ok: boolean;
  label: string;
  target: string;
}) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-line px-2 py-1">
      <span
        className={`flex items-center gap-2 ${
          ok ? 'text-status-green' : 'text-status-amber'
        }`}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
        {label}
      </span>
      <span className="text-[10px] text-ink-3">{target}</span>
    </li>
  );
}

/**
 * Cell-style input — registers itself with the parent's keyboard
 * navigator. Single-click selects the value (Excel-like) so typing
 * replaces it.
 */
function CellInput({
  kind,
  value,
  onChange,
  onKeyDown,
  innerRef,
  disabled,
}: {
  kind: 'text' | 'integer' | 'decimal' | 'dollars';
  value: string | number;
  onChange: (v: string | number) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  innerRef: (el: HTMLInputElement | null) => void;
  disabled?: boolean;
}) {
  const isNumeric = kind !== 'text';
  return (
    <input
      ref={innerRef}
      type={isNumeric ? 'number' : 'text'}
      value={value}
      step={kind === 'decimal' ? 0.5 : kind === 'dollars' ? 100 : 1}
      min={isNumeric ? 0 : undefined}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={onKeyDown}
      onChange={(e) => {
        if (kind === 'text') {
          onChange(e.target.value);
        } else if (kind === 'integer' || kind === 'dollars') {
          onChange(Math.round(Number(e.target.value || 0)));
        } else {
          onChange(Number(e.target.value || 0));
        }
      }}
      disabled={disabled}
      className={`h-7 w-full rounded border border-line bg-surface-elev px-1.5 ${
        isNumeric ? 'text-right tabular-nums' : 'text-left'
      } text-xs text-ink focus:border-brand focus:bg-white disabled:bg-surface-subtle disabled:text-ink-3`}
    />
  );
}
