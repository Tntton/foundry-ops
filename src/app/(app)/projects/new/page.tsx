import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { listActivePeopleOptions, listClientOptions } from '@/server/projects';
import { NewProjectForm } from './form';

export default async function NewProjectPage() {
  const session = await getSession();
  if (!hasCapability(session, 'project.create')) notFound();

  const [clients, people] = await Promise.all([listClientOptions(), listActivePeopleOptions()]);
  const partners = people.filter((p) => p.band === 'Partner' || p.band === 'MP');

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/projects" className="text-ink-3 hover:text-ink">
          ← Back to Projects
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New project</h1>
        <p className="text-sm text-ink-3">
          Basics + commercials + team. SharePoint folders auto-provision on save; Xero
          tracking category is created on the first invoice or bill push. Milestones are
          editable from the project detail after create.
        </p>
      </header>

      {clients.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card p-8 text-center text-sm text-ink-3">
          Create a client first —{' '}
          <Link href="/directory/clients/new" className="text-brand hover:underline">
            New client →
          </Link>
        </div>
      ) : (
        <NewProjectForm clients={clients} partners={partners} managers={people} />
      )}
    </div>
  );
}
