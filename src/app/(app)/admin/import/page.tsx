import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { Card } from '@/components/ui/card';

/**
 * Bulk-import landing page. Two surfaces, mirror identical flow:
 * upload → preview → commit. Both gated behind admin capabilities so
 * the office manager (Jas) can self-serve the FY26 historical backfill
 * without involving TT.
 */
export default async function BulkImportLandingPage() {
  const session = await getSession();
  const canPersonnel = hasCapability(session, 'person.create');
  const canTimesheets = hasCapability(session, 'timesheet.approve');
  if (!canPersonnel && !canTimesheets) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Bulk import</h1>
        <p className="mt-1 text-sm text-ink-3">
          Self-serve historical-data loaders. Each import previews every row before
          anything writes to the database, then a single explicit commit click
          drops the batch in one transaction.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {canPersonnel && (
          <Link
            href="/admin/import/personnel"
            className="block transition hover:-translate-y-0.5"
          >
            <Card className="p-5">
              <h2 className="text-base font-semibold text-ink">Personnel</h2>
              <p className="mt-2 text-sm text-ink-3">
                Upload a CSV of Person rows. Matches existing people by email
                (upsert), or creates new ones. Derives initials automatically
                when not supplied.
              </p>
              <p className="mt-3 font-mono text-xs text-ink-4">
                /admin/import/personnel
              </p>
            </Card>
          </Link>
        )}
        {canTimesheets && (
          <Link
            href="/admin/import/timesheets"
            className="block transition hover:-translate-y-0.5"
          >
            <Card className="p-5">
              <h2 className="text-base font-semibold text-ink">Timesheets</h2>
              <p className="mt-2 text-sm text-ink-3">
                Upload a CSV of historical timesheet entries. Rows land pre-approved
                (with you as the approver) so they skip the manual approval queue.
                Duplicates are detected against existing entries.
              </p>
              <p className="mt-3 font-mono text-xs text-ink-4">
                /admin/import/timesheets
              </p>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
