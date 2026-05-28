'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { PoolStatus } from '@prisma/client';
import { PersonAvatar } from '@/components/person-avatar';
import {
  POOL_STATUS_OPTIONS,
  POOL_STATUS_STYLES,
} from '@/server/pool-status';
import {
  setPoolStatusOverride,
  listActiveProjectsForPick,
  type ActiveProjectPick,
} from './pool-status-action';

/**
 * Person chip for the resource-planning pool. Renders as a coloured
 * pill (driven by `effectiveStatus`) and — for super admins — opens a
 * native-style context menu on right-click letting them override the
 * status. Selecting an option fires a server action; "Auto" clears the
 * override so the computed status takes over again.
 */
export function PoolChip({
  personId,
  initials,
  firstName,
  lastName,
  headshotUrl,
  effectiveStatus,
  hasOverride,
  canOverride,
  currentProjectCodes,
}: {
  personId: string;
  initials: string;
  firstName: string;
  lastName: string;
  headshotUrl: string | null;
  effectiveStatus: PoolStatus;
  /** True when poolStatusOverride is non-null — used to surface the
   *  "Auto (computed)" option as the active highlight target. */
  hasOverride: boolean;
  canOverride: boolean;
  /** Active project codes the person is on. Surfaced inline on the
   *  chip when status === on_project so partners can see at a glance
   *  what they're allocated to. */
  currentProjectCodes: string[];
}) {
  const styles = POOL_STATUS_STYLES[effectiveStatus];
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const [view, setView] = useState<'main' | 'pick-project'>('main');
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<ActiveProjectPick[] | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    function onAway(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
        setView('main');
        setError(null);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenu(null);
        setView('main');
        setError(null);
      }
    }
    document.addEventListener('mousedown', onAway);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onAway);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menu]);

  function onContextMenu(e: React.MouseEvent) {
    if (!canOverride) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
    setView('main');
    setError(null);
    setPicks(new Set());
  }

  /**
   * Apply the pool-status pick. For `on_project` we route through a
   * sub-view that requires picking ≥1 project (unless they already
   * hold an active membership) so the chip's status implies real team
   * data — the bandwidth heatmap + current-project lists are sourced
   * from ProjectTeam, so flipping the colour without an attachment
   * would mislead partners.
   */
  async function pick(status: PoolStatus | null) {
    setError(null);
    if (status === 'on_project') {
      // Lazy-load the project list the first time the substep opens so
      // chip render stays cheap.
      if (projects === null) {
        setProjectsLoading(true);
        try {
          const list = await listActiveProjectsForPick(personId);
          setProjects(list);
        } finally {
          setProjectsLoading(false);
        }
      }
      setView('pick-project');
      return;
    }
    setMenu(null);
    startTransition(async () => {
      const r = await setPoolStatusOverride(personId, status);
      if (!r.ok) setError(r.message);
    });
  }

  function commitOnProject() {
    setError(null);
    const ids = [...picks];
    const alreadyOn = (projects ?? []).some((p) => p.alreadyOnTeam);
    if (ids.length === 0 && !alreadyOn) {
      setError('Select at least one project to attach.');
      return;
    }
    startTransition(async () => {
      const r = await setPoolStatusOverride(personId, 'on_project', ids);
      if (!r.ok) {
        setError(r.message);
      } else {
        setMenu(null);
        setView('main');
        setPicks(new Set());
      }
    });
  }

  function togglePick(projectId: string) {
    setPicks((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  return (
    <>
      <Link
        href={`/directory/people/${personId}`}
        onContextMenu={onContextMenu}
        title={
          canOverride
            ? `${styles.label} — right-click to override`
            : styles.label
        }
        className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs hover:border-brand ${styles.bg} ${styles.border} ${styles.text} ${
          pending ? 'opacity-60' : ''
        }`}
      >
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${styles.pip}`} />
        <PersonAvatar
          className="h-5 w-5"
          fallbackClassName="text-[9px]"
          initials={initials}
          headshotUrl={headshotUrl}
        />
        <span>
          {firstName} {lastName}
        </span>
        {/* Show currently allocated project codes when on-project so the
             chip carries enough info to be actionable without a click-
             through. Cap at 2 codes inline (overflow indicated). */}
        {effectiveStatus === 'on_project' && currentProjectCodes.length > 0 && (
          <span className="ml-1 inline-flex items-center gap-0.5 text-[9px] font-mono text-status-green">
            {currentProjectCodes.slice(0, 2).join(' · ')}
            {currentProjectCodes.length > 2 && (
              <span className="text-ink-3">
                +{currentProjectCodes.length - 2}
              </span>
            )}
          </span>
        )}
        {hasOverride && (
          <span
            className="text-[9px] uppercase tracking-wider text-ink-3"
            title="Status manually set by a super admin"
          >
            ⊕
          </span>
        )}
      </Link>

      {menu && canOverride && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            left: Math.min(menu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - (view === 'pick-project' ? 320 : 220)),
            top: Math.min(menu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 280),
            zIndex: 50,
          }}
          className={`overflow-hidden rounded-md border border-line bg-card shadow-lg ${
            view === 'pick-project' ? 'w-80' : 'w-52'
          }`}
        >
          {view === 'main' && (
            <>
              <div className="border-b border-line px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                {firstName} {lastName} · status
              </div>
              {POOL_STATUS_OPTIONS.map((opt) => {
                const active = hasOverride && opt.value === effectiveStatus;
                const optStyles = POOL_STATUS_STYLES[opt.value];
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="menuitem"
                    disabled={pending}
                    onClick={() => pick(opt.value)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                      active
                        ? 'bg-surface-hover text-ink'
                        : 'text-ink-2 hover:bg-surface-hover hover:text-ink'
                    }`}
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${optStyles.pip}`}
                    />
                    <span>{opt.label}</span>
                    {opt.value === 'on_project' && (
                      <span className="ml-auto text-[10px] text-ink-3">
                        pick projects →
                      </span>
                    )}
                    {active && opt.value !== 'on_project' && (
                      <span className="ml-auto text-[10px] uppercase tracking-wide">
                        Active
                      </span>
                    )}
                  </button>
                );
              })}
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                onClick={() => pick(null)}
                className="flex w-full items-center gap-2 border-t border-line px-3 py-1.5 text-left text-sm text-ink-3 hover:bg-surface-hover hover:text-ink"
              >
                <span className="inline-block h-2 w-2 rounded-full border border-ink-3" />
                <span>{hasOverride ? 'Clear override' : 'Auto (computed)'}</span>
              </button>
              {error && (
                <div className="border-t border-line px-3 py-2 text-xs text-status-red">
                  {error}
                </div>
              )}
            </>
          )}

          {view === 'pick-project' && (
            <>
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                  Pick project(s)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setView('main');
                    setError(null);
                  }}
                  className="text-[10px] text-ink-3 hover:text-ink"
                >
                  ← back
                </button>
              </div>
              <p className="border-b border-line px-3 py-1.5 text-[10px] text-ink-3">
                Adds {firstName} to the selected project teams at 0%
                allocation (refine on the Team tab). They&apos;ll show on
                the bandwidth heatmap when permanent staff.
              </p>
              <div className="max-h-72 overflow-y-auto">
                {projectsLoading && (
                  <div className="px-3 py-3 text-xs text-ink-3">
                    Loading projects…
                  </div>
                )}
                {!projectsLoading && projects && projects.length === 0 && (
                  <div className="px-3 py-3 text-xs text-ink-3">
                    No active projects available.
                  </div>
                )}
                {!projectsLoading &&
                  projects &&
                  projects.map((p) => {
                    const checked = picks.has(p.projectId);
                    return (
                      <label
                        key={p.projectId}
                        className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface-hover ${
                          p.alreadyOnTeam ? 'bg-status-green-soft/40' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked || p.alreadyOnTeam}
                          disabled={p.alreadyOnTeam}
                          onChange={() => togglePick(p.projectId)}
                          className="h-3.5 w-3.5"
                        />
                        <span className="font-mono text-[10px] text-ink-3">
                          {p.code}
                        </span>
                        <span className="flex-1 text-ink">{p.name}</span>
                        {p.alreadyOnTeam ? (
                          <span className="text-[9px] uppercase tracking-wide text-status-green">
                            on team
                          </span>
                        ) : (
                          <span className="text-[9px] uppercase tracking-wide text-ink-4">
                            {p.stage}
                          </span>
                        )}
                      </label>
                    );
                  })}
              </div>
              {error && (
                <div className="border-t border-line bg-status-red-soft px-3 py-2 text-xs text-status-red">
                  {error}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-subtle/40 px-3 py-2">
                <button
                  type="button"
                  onClick={() => {
                    setView('main');
                    setError(null);
                  }}
                  className="text-[11px] text-ink-3 hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={commitOnProject}
                  className="rounded-md bg-brand px-2 py-1 text-[11px] font-medium text-brand-ink hover:bg-brand/90 disabled:opacity-60"
                >
                  {pending ? 'Saving…' : 'Confirm on-project'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
