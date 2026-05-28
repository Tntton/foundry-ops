/**
 * Waterfall chart — adapted from the design prototype's
 * `InteractiveWaterfall` (screens-pnl.jsx). SVG-based, no chart-lib
 * dependency. Used for both the firm P&L summary on /pnl and the
 * per-project waterfall on each project's Overview tab.
 *
 * Data shape: an ordered list of `WaterfallStep`s. Three step kinds:
 *   - `total`    : full-height bar starting at 0 (e.g. Booked).
 *   - `subtotal` : floats at the running total (e.g. Invoiced, Margin).
 *   - `flow`     : a positive or negative relative move (e.g. -Cost).
 *
 * Tones map onto Foundry's status palette so the chart matches the
 * rest of the dashboard rather than the prototype's bespoke greens.
 */

export type WaterfallTone =
  | 'brand'
  | 'green'
  | 'amber'
  | 'red'
  | 'muted'
  | 'orange';

export type WaterfallStep = {
  key: string;
  label: string;
  /** Sub-label shown below the main label — e.g. "signed contracts" or
   *  "30% reserve · estimated". */
  sub?: string;
  /** Cents. Positive = build-up, negative = deduction. */
  valueCents: number;
  kind: 'total' | 'subtotal' | 'flow';
  tone: WaterfallTone;
  /** When true, render the bar with a hatched / placeholder fill — used
   *  for steps where we don't yet have real data and the value is an
   *  estimate. */
  estimated?: boolean;
};

const TONE_HEX: Record<WaterfallTone, string> = {
  brand: '#1e3a34',
  green: '#3f7a5f',
  amber: '#c79a3a',
  red: '#c25450',
  muted: '#8b8984',
  orange: '#b87c3f',
};

function fmtMoneyShort(cents: number): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const sign = dollars < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function WaterfallChart({
  steps,
  height = 320,
  /** Used to switch the tooltip / legend between firm-wide and per-
   *  project context. */
  caption,
}: {
  steps: WaterfallStep[];
  height?: number;
  caption?: string;
}) {
  // Compute bar geometry — running total tracks the current top of the
  // stack as we traverse left to right.
  let running = 0;
  type Bar = WaterfallStep & { top: number; bottom: number };
  const bars: Bar[] = steps.map((s, i) => {
    let top: number;
    let bottom: number;
    if (s.kind === 'total' && i === 0) {
      top = s.valueCents;
      bottom = 0;
      running = s.valueCents;
    } else if (s.kind === 'subtotal' || s.kind === 'total') {
      top = running;
      bottom = 0;
    } else {
      // flow — relative move from the running total
      if (s.valueCents >= 0) {
        bottom = running;
        top = running + s.valueCents;
      } else {
        top = running;
        bottom = running + s.valueCents;
      }
      running += s.valueCents;
    }
    return { ...s, top, bottom };
  });

  const maxRunning = Math.max(0, ...bars.map((b) => b.top));
  const minRunning = Math.min(0, ...bars.map((b) => b.bottom));
  // Pad the y-range so labels don't crash into the top edge.
  const yPad = (maxRunning - minRunning) * 0.08;
  const maxY = maxRunning + yPad;
  const minY = minRunning - yPad * 0.4;

  // Viewport — width grows with bar count so each bar stays a sensible
  // size whether we're rendering a 5-step project waterfall or the
  // 9-step firm cascade. Aspect ratio is preserved (no stretching) so
  // text renders at its intended size.
  const padT = 32;
  const padB = 72;
  const padL = 64;
  const padR = 16;
  const n = bars.length;
  const gap = 22;
  const bwTarget = 96; // intended bar width in viewBox units
  const W = padL + padR + n * bwTarget + (n - 1) * gap;
  const H = height;
  const plotH = H - padT - padB;
  const plotW = W - padL - padR;
  const bw = n > 0 ? (plotW - gap * (n - 1)) / n : 0;

  function y(v: number): number {
    if (maxY === minY) return padT + plotH / 2;
    return padT + plotH * (1 - (v - minY) / (maxY - minY));
  }
  function x(i: number): number {
    return padL + i * (bw + gap);
  }

  // Y-axis grid lines — pick 4–6 round dollar values across the range.
  const range = maxY - minY;
  const step =
    range >= 1_000_000_00
      ? 500_000_00
      : range >= 200_000_00
        ? 100_000_00
        : range >= 100_000_00
          ? 50_000_00
          : range >= 20_000_00
            ? 10_000_00
            : range >= 5_000_00
              ? 2_500_00
              : 1_000_00;
  const gridValues: number[] = [];
  const startGrid = Math.ceil(minY / step) * step;
  for (let v = startGrid; v <= maxY; v += step) gridValues.push(v);

  return (
    <div className="rounded-md border border-line bg-card p-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        className="block w-full"
        style={{ maxHeight: height }}
        role="img"
        aria-label="Waterfall chart"
      >
        <defs>
          <pattern
            id="wf-hatch"
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="#b87c3f"
              strokeWidth="1.2"
              opacity="0.45"
            />
          </pattern>
          <pattern
            id="wf-hatch-muted"
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="6"
              stroke="#8b8984"
              strokeWidth="1.2"
              opacity="0.4"
            />
          </pattern>
        </defs>

        {/* Y-axis grid */}
        {gridValues.map((v) => (
          <g key={v}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(v)}
              y2={y(v)}
              stroke="#eeece5"
              strokeWidth="1"
            />
            <text
              x={padL - 8}
              y={y(v) + 4}
              fontSize="13"
              fill="#8b8984"
              textAnchor="end"
            >
              {v === 0 ? '$0' : fmtMoneyShort(v)}
            </text>
          </g>
        ))}
        {/* Zero baseline */}
        <line
          x1={padL}
          x2={W - padR}
          y1={y(0)}
          y2={y(0)}
          stroke="#c9c4b8"
          strokeWidth="1.2"
        />

        {bars.map((b, i) => {
          const isFlow = b.kind === 'flow';
          const neg = b.valueCents < 0;
          const barTop = y(b.top);
          const barBottom = y(b.bottom);
          const barH = Math.max(2, barBottom - barTop);
          const fill = TONE_HEX[b.tone];
          const isSubtotal = b.kind === 'subtotal' || b.kind === 'total';
          const useHatch = b.estimated || (isFlow && neg);
          const fillAttr = useHatch
            ? b.estimated
              ? 'url(#wf-hatch-muted)'
              : 'url(#wf-hatch)'
            : fill;
          const strokeAttr = b.estimated
            ? '#8b8984'
            : isFlow && neg
              ? '#b87c3f'
              : fill;
          return (
            <g key={b.key}>
              {/* Connector dashed line from previous bar */}
              {i > 0 && (
                <line
                  x1={x(i - 1) + bw}
                  x2={x(i)}
                  y1={y(bars[i - 1]!.top)}
                  y2={isFlow ? (neg ? y(b.top) : y(b.bottom)) : y(b.top)}
                  stroke="#b8b2a6"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              )}
              <rect
                x={x(i)}
                y={barTop}
                width={bw}
                height={barH}
                fill={fillAttr}
                stroke={strokeAttr}
                strokeWidth="1.2"
                rx="2"
              />
              {isSubtotal && (
                <line
                  x1={x(i)}
                  x2={x(i) + bw}
                  y1={barTop}
                  y2={barTop}
                  stroke="#111"
                  strokeWidth="2"
                />
              )}
              {/* Value label above (or below if negative flow) */}
              <text
                x={x(i) + bw / 2}
                y={isFlow && neg ? barBottom + 18 : barTop - 8}
                fontSize="14"
                fontWeight="600"
                fill={isFlow && neg ? '#b87c3f' : '#1e3a34'}
                textAnchor="middle"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
              >
                {fmtMoneyShort(b.valueCents)}
              </text>
              {/* Step label on x-axis */}
              <text
                x={x(i) + bw / 2}
                y={H - padB + 18}
                fontSize="13"
                fill="#3c3c36"
                textAnchor="middle"
                fontWeight={isSubtotal ? '600' : '400'}
              >
                {b.label}
              </text>
              {b.sub && (
                <text
                  x={x(i) + bw / 2}
                  y={H - padB + 34}
                  fontSize="11"
                  fill="#8b8984"
                  textAnchor="middle"
                >
                  {b.sub}
                </text>
              )}
              {b.estimated && (
                <text
                  x={x(i) + bw / 2}
                  y={H - padB + 50}
                  fontSize="10"
                  fill="#b87c3f"
                  textAnchor="middle"
                  fontStyle="italic"
                >
                  estimated
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-ink-3">
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-3.5 rounded"
            style={{ background: TONE_HEX.brand }}
          />
          Revenue position
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-3.5 rounded"
            style={{ background: TONE_HEX.green }}
          />
          Margin / profit
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-3.5 rounded border border-[#b87c3f] bg-white"
            style={{ backgroundImage: 'repeating-linear-gradient(45deg, #b87c3f 0 1px, transparent 1px 4px)' }}
          />
          Cost / deduction
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-3.5 rounded border border-[#8b8984] bg-white"
            style={{ backgroundImage: 'repeating-linear-gradient(45deg, #8b8984 0 1px, transparent 1px 4px)' }}
          />
          Estimated (data not yet tracked)
        </span>
        {caption && (
          <span className="ml-auto italic text-ink-4">{caption}</span>
        )}
      </div>
    </div>
  );
}
