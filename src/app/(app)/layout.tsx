import { redirect } from 'next/navigation';
import { getSession } from '@/server/session';
import { countUnreadUpdates } from '@/server/user-updates';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { MobileNavProvider } from '@/components/shell/mobile-nav';
import { FeedbackWidget } from '@/components/feedback-widget';
import { AssistantWidget } from '@/components/assistant-widget';
import { PeriodAutoRefresh } from '@/components/shell/period-refresh';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/api/auth/signin');
  }

  // Pathname is no longer threaded through here — Sidebar reads it
  // client-side via usePathname() so the active highlight follows
  // client-side navigations (Link prefetch + soft transitions).
  const displayName = `${session.person.firstName} ${session.person.lastName}`;
  // Unread UserUpdate count drives the bubble next to "Dashboard" in
  // the nav. Cheap query (indexed on (personId, readAt)) so it's fine
  // to run on every layout render. Defensive try/catch so a stale
  // Prisma client (e.g. dev server hasn't restarted after a schema
  // push) or DB blip doesn't take down the entire shell — the badge
  // just shows zero until the next render.
  let unreadUpdates = 0;
  try {
    unreadUpdates = await countUnreadUpdates(session.person.id);
  } catch (err) {
    console.error('[layout.unreadUpdates] failed (badge will show 0):', err);
  }
  const activeOverlayRoles = session.viewAsRoles ?? null;
  const isViewing =
    activeOverlayRoles !== null && activeOverlayRoles.length > 0;
  const viewAsLabel = isViewing ? activeOverlayRoles!.join(' + ') : null;

  return (
    <MobileNavProvider>
      <div className="flex h-screen bg-surface">
        {/* Calendar / date-driven views use server `new Date()` so they
             naturally roll forward each request. This keeps a tab open
             across Sunday → Monday in step by triggering a soft
             `router.refresh()` at the boundary. */}
        <PeriodAutoRefresh />
        <Sidebar
          roles={session.person.roles}
          band={session.person.band}
          badges={{ '/': unreadUpdates }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            initials={session.person.initials}
            displayName={displayName}
            email={session.person.email}
            headshotUrl={session.person.headshotUrl}
            roles={session.person.roles}
            isRealSuperAdmin={session.isRealSuperAdmin}
            viewAsRoles={session.viewAsRoles}
          />
          {/* Persistent view-as banner — always visible while the overlay
               is active so the super-admin can't forget they're not
               seeing their own permissions. Click "Exit" via the user
               menu to drop the overlay. */}
          {isViewing && (
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-status-amber bg-status-amber-soft px-3 py-1.5 text-xs text-status-amber md:px-6">
              <span>
                <strong>View-as mode</strong> · permissions overlaid as{' '}
                <span className="font-mono">{viewAsLabel}</span>. Audit
                attribution still points at your real account.
              </span>
              <span className="text-[11px]">Exit via the user menu →</span>
            </div>
          )}
          <main className="flex-1 overflow-y-auto p-3 md:p-6">{children}</main>
        </div>
        {/* Floating feedback widget — sits just left of the assistant pill.
            Pilot users use it to log bugs / feature requests / maintenance
            gripes; triage happens at /admin/feedback. */}
        <FeedbackWidget />
        {/* In-app AI assistant — bottom-right primary widget. */}
        <AssistantWidget />
      </div>
    </MobileNavProvider>
  );
}
