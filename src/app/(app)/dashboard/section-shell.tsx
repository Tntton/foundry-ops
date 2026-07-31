import type { ReactNode } from 'react';
import {
  SECTION_LABEL,
  type DashboardColumn,
  type DashboardSectionKey,
} from '@/server/dashboard-sections';
import { updateDashboardLayout } from './layout-actions';

/**
 * Wraps one dashboard section with a slim customisation toolbar: move
 * up/down within the column, jump to the other column, collapse to the
 * header, or hide entirely. Every control is a server-action form post
 * (no client JS / drag-drop), so this stays a server component and
 * composes with the page's existing server-rendered cards.
 *
 * The toolbar is muted until the section is hovered/focused so the
 * dashboard stays clean, but it's always reachable (keyboard + touch).
 */
export function SectionShell({
  sectionKey,
  column,
  collapsed,
  isFirst,
  isLast,
  children,
}: {
  sectionKey: DashboardSectionKey;
  column: DashboardColumn;
  collapsed: boolean;
  isFirst: boolean;
  isLast: boolean;
  children: ReactNode;
}) {
  const label = SECTION_LABEL[sectionKey];
  const otherColumn = column === 'main' ? 'aside column' : 'main column';
  return (
    <section
      className="group/section relative rounded-lg"
      aria-label={label}
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink-4">
          {label}
        </span>
        <div className="ml-auto flex items-center gap-0.5 opacity-40 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100">
          <LayoutButton
            sectionKey={sectionKey}
            op="move_up"
            title={`Move ${label} up`}
            disabled={isFirst}
          >
            ↑
          </LayoutButton>
          <LayoutButton
            sectionKey={sectionKey}
            op="move_down"
            title={`Move ${label} down`}
            disabled={isLast}
          >
            ↓
          </LayoutButton>
          <LayoutButton
            sectionKey={sectionKey}
            op="move_column"
            title={`Move ${label} to the ${otherColumn}`}
          >
            {column === 'main' ? '⇥' : '⇤'}
          </LayoutButton>
          <LayoutButton
            sectionKey={sectionKey}
            op={collapsed ? 'expand' : 'collapse'}
            title={collapsed ? `Expand ${label}` : `Collapse ${label}`}
          >
            {collapsed ? '▸' : '▾'}
          </LayoutButton>
          <LayoutButton
            sectionKey={sectionKey}
            op="hide"
            title={`Hide ${label}`}
          >
            ✕
          </LayoutButton>
        </div>
      </div>
      {!collapsed && children}
    </section>
  );
}

function LayoutButton({
  sectionKey,
  op,
  title,
  disabled,
  children,
}: {
  sectionKey: DashboardSectionKey;
  op:
    | 'move_up'
    | 'move_down'
    | 'move_column'
    | 'collapse'
    | 'expand'
    | 'hide';
  title: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const cls =
    'inline-flex h-6 w-6 items-center justify-center rounded text-xs leading-none text-ink-3';
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        aria-hidden
        className={`${cls} cursor-not-allowed opacity-30`}
        tabIndex={-1}
      >
        {children}
      </button>
    );
  }
  return (
    <form action={updateDashboardLayout} className="inline-flex">
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="key" value={sectionKey} />
      <button
        type="submit"
        title={title}
        aria-label={title}
        className={`${cls} hover:bg-surface-hover hover:text-ink`}
      >
        {children}
      </button>
    </form>
  );
}

/**
 * Footer bar under the dashboard grid: chips to restore hidden sections
 * and a reset-to-default control. Renders nothing when there's nothing
 * hidden and the layout is untouched.
 */
export function DashboardLayoutTray({
  hidden,
  isCustomised,
}: {
  hidden: DashboardSectionKey[];
  isCustomised: boolean;
}) {
  if (hidden.length === 0 && !isCustomised) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
      <span className="text-[10px] uppercase tracking-wider text-ink-4">
        Layout
      </span>
      {hidden.map((key) => (
        <form key={key} action={updateDashboardLayout} className="inline-flex">
          <input type="hidden" name="op" value="show" />
          <input type="hidden" name="key" value={key} />
          <button
            type="submit"
            className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2.5 py-1 text-[11px] text-ink-2 hover:border-brand hover:bg-surface-hover"
            title={`Show ${SECTION_LABEL[key]} again`}
          >
            <span className="text-ink-4">hidden ·</span>
            {SECTION_LABEL[key]}
            <span className="font-semibold text-brand">Show</span>
          </button>
        </form>
      ))}
      {isCustomised && (
        <form action={updateDashboardLayout} className="ml-auto inline-flex">
          <input type="hidden" name="op" value="reset" />
          <button
            type="submit"
            className="rounded-full border border-line bg-card px-2.5 py-1 text-[11px] text-ink-3 hover:border-brand hover:bg-surface-hover hover:text-ink"
            title="Reset the dashboard to its default layout"
          >
            Reset layout
          </button>
        </form>
      )}
    </div>
  );
}
