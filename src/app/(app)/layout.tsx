import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSession } from '@/server/session';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/api/auth/signin');
  }

  const h = headers();
  const pathname = h.get('x-pathname') ?? h.get('x-invoke-path') ?? '/';
  const displayName = `${session.person.firstName} ${session.person.lastName}`;

  return (
    <div className="flex h-screen bg-surface">
      <Sidebar roles={session.person.roles} currentPath={pathname} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          initials={session.person.initials}
          displayName={displayName}
          email={session.person.email}
        />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
