import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { Card } from '@/components/ui/card';

/**
 * Bulk-import landing page. Four surfaces, all the same shape:
 * upload → dry-run preview → explicit commit. Each gated behind the
 * capability appropriate to the entity being imported so the office
 * manager (Jas) can self-serve the FY26 historical backfill without
 * involving TT.
 */
export default async function BulkImportLandingPage() {
  const session = await getSession();
  const canPersonnel = hasCapability(session, 'person.create');
  const canTimesheets = hasCapability(session, 'timesheet.approve');
  const canBills = hasCapability(session, 'bill.create');
  const canExpenses = hasCapability(session, 'expense.approve.under_2k');
  if (!canPersonnel && !canTimesheets && !canBills && !canExpenses) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Data imports</h1>
        <p className="mt-1 text-sm text-ink-3">
          Self-serve historical-data loaders. Each import previews every row before
          anything writes to the database, then a single explicit commit click
          drops the batch in one transaction.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {canPersonnel && (
          <ImporterCard
            href="/admin/import/personnel"
            title="Personnel"
            blurb="Upload a CSV of Person rows. Matches existing people by email (upsert), or creates new ones. Derives initials automatically when not supplied."
          />
        )}
        {canTimesheets && (
          <ImporterCard
            href="/admin/import/timesheets"
            title="Timesheets"
            blurb="Upload a CSV of historical timesheet entries. Rows land pre-approved (with you as the approver) so they skip the manual approval queue. Duplicates are detected against existing entries."
          />
        )}
        {canBills && (
          <ImporterCard
            href="/admin/import/bills"
            title="Bills (AP)"
            blurb="Upload a CSV of historical vendor invoices. Tag each row to a project code (or leave blank for OPEX). Bills land in status='paid' for historical backfill. Duplicates detected on (supplier, invoice number)."
          />
        )}
        {canExpenses && (
          <ImporterCard
            href="/admin/import/expenses"
            title="Expenses (receipts)"
            blurb="Upload a CSV of personal expense claims / receipts. Match each row to a Person by email and optionally to a project code. Rows land pre-approved with you as the approver."
          />
        )}
      </div>
    </div>
  );
}

function ImporterCard({
  href,
  title,
  blurb,
}: {
  href: string;
  title: string;
  blurb: string;
}) {
  return (
    <Link href={href} className="block transition hover:-translate-y-0.5">
      <Card className="p-5">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <p className="mt-2 text-sm text-ink-3">{blurb}</p>
        <p className="mt-3 font-mono text-xs text-ink-4">{href}</p>
      </Card>
    </Link>
  );
}
