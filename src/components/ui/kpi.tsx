import * as React from 'react';
import { cn } from '@/lib/utils';

type Trend = 'up' | 'down' | 'flat';

export type KPIProps = React.HTMLAttributes<HTMLDivElement> & {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  trend?: Trend;
};

const trendClasses: Record<Trend, string> = {
  up: 'text-status-green',
  down: 'text-status-red',
  flat: 'text-ink-3',
};

const trendSymbol: Record<Trend, string> = {
  up: '▲',
  down: '▼',
  flat: '—',
};

export function KPI({ label, value, sub, trend, className, ...props }: KPIProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border border-line bg-card p-5 shadow-sm',
        className,
      )}
      {...props}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</div>
      <div className="font-display text-3xl font-semibold tabular-nums text-ink">{value}</div>
      {(sub || trend) && (
        <div className="flex items-center gap-1 text-xs text-ink-3">
          {trend && <span className={trendClasses[trend]}>{trendSymbol[trend]}</span>}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  );
}
