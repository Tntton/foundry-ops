import { redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { countUnreadUpdates } from '@/server/user-updates';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { MobileNavProvider } from '@/components/shell/mobile-nav';
import { FeedbackWidget } from '@/components/feedback-widget';
import { AssistantWidget } from '@/components/assistant-widget';
import { PeriodAutoRefresh } from '@/components/shell/period-refresh';
import { OnboardingWizard } from '@/components/onboarding-wizard';
import { onboardingFor, resolvePrimaryRole } from '@/server/onboarding';

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

  // First-login onboarding tour. Runs when the person has never
  // dismissed it. Defensive try/catch so a missing column (pre-
  // migration) or DB blip never blocks the shell — worst case the
  // tour just doesn't render.
  let onboardingProfile: ReturnType<typeof onboardingFor> | null = null;
  try {
    const row = await prisma.person.findUnique({
      where: { id: session.person.id },
      select: { onboardingCompletedAt: true },
    });
    if (row && row.onboardingCompletedAt === null) {
      const primary = resolvePrimaryRole(session.person.roles);
      onboardingProfile = onboardingFor(primary, session.person.firstName);
    }
  } catch (err) {
    console.error('[layout.onboarding] read failed (tour will not render):', err);
  }
  const activeOverlayRoles = session.viewAsRoles ?? null;
  const isViewing =
    activeOverlayRoles !== null && activeOverlayRoles.length > 0;
  const viewAsLabel = isViewing ? activeOverlayRoles!.join(' + ') : null;

  return (
    <MobileNavProvider>
      {/* h-dvh (dynamic viewport height) instead of h-screen — on iOS
           Safari, 100vh measures the full viewport including the URL
           bar's area, so a 100vh container is taller than what's
           visible while the bar is showing, and the overflow-y-auto
           main below is sized too tall → content at the bottom can't
           scroll into view. 100dvh is the dynamic value that updates
           with the chrome state, so the container fits the visible
           area and inner scrolling works correctly. Tailwind 3.4+. */}
      <div className="flex h-dvh bg-surface">
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
          {/* Bottom padding clears the floating Assistant + Feedback
               pills (bottom-4 + ~32px pills = needs ~52px clearance).
               pb-24 gives a comfortable buffer on mobile; pb-6 on
               desktop where the pills sit over empty space anyway. */}
          <main className="flex-1 overflow-y-auto p-3 pb-24 md:p-6 md:pb-6">
            {children}
          </main>
        </div>
        {/* Floating feedback widget — sits just left of the assistant pill.
            Pilot users use it to log bugs / feature requests / maintenance
            gripes; triage happens at /admin/feedback. */}
        <FeedbackWidget />
        {/* In-app AI assistant — bottom-right primary widget. */}
        <AssistantWidget />
        {/* First-login onboarding tour — role-scoped. Renders only when
             Person.onboardingCompletedAt is null; the wizard's own
             action stamps that field so it won't re-appear next visit. */}
        {onboardingProfile && <OnboardingWizard profile={onboardingProfile} />}
      </div>
    </MobileNavProvider>
  );
}
