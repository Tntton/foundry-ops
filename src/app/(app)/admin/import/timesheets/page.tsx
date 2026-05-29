import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { readTimesheets } from '@/server/imports/cache';
import { CsvDropzone } from '../_components/csv-dropzone';
import { TimesheetPreviewView } from './preview';
import { parseTimesheetCsv } from './actions';

type SearchParams = {
  stage?: string;
  token?: string;
  committed?: string;
  inserted?: string;
  overwritten?: string;
  skipped?: string;
  rejected?: string;
};

export default async function TimesheetImportPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'timesheet.approve')) notFound();

  if (searchParams.stage === 'preview' && searchParams.token) {
    const preview = readTimesheets(session.person.id, searchParams.token);
    if (!preview) {
      return (
        <div className="space-y-4">
          <Header />
          <div className="rounded-md border border-status-red bg-status-red-soft px-4 py-3 text-sm text-status-red">
            Preview expired or not found. Re-upload the file.
          </div>
          <Link href="/admin/import/timesheets" className="text-sm text-status-blue hover:underline">
            ← Back to upload
          </Link>
        </div>
      );
    }
    return <TimesheetPreviewView preview={preview} token={searchParams.token} />;
  }

  const justCommitted = searchParams.committed === '1';

  return (
    <div className="space-y-6">
      <Header />
      {justCommitted && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-4 py-3 text-sm text-status-green">
          Import committed — {searchParams.inserted ?? '0'} inserted ·{' '}
          {searchParams.overwritten ?? '0'} overwritten ·{' '}
          {searchParams.skipped ?? '0'} duplicates skipped ·{' '}
          {searchParams.rejected ?? '0'} rejected. View entries in{' '}
          <Link href="/timesheet" className="font-medium underline">/timesheet</Link>.
        </div>
      )}
      <div className="rounded-lg border border-line bg-card p-5">
        <h2 className="text-sm font-semibold text-ink">Upload a timesheet CSV</h2>
        <p className="mt-1 text-xs text-ink-3">
          Historical timesheets land pre-approved (with you as the approver) so they
          skip the manual approval queue. Rows without a matching person email or
          project code are rejected. Duplicates are detected against existing
          entries — default is to skip them; you can switch to overwrite on the
          preview screen.
        </p>
        <div className="mt-4">
          <CsvDropzone
            parseAction={parseTimesheetCsv}
            redirectTo="/admin/import/timesheets"
            helpText="CSV with one row per timesheet entry. Required columns: personEmail, projectCode, date (YYYY-MM-DD), hours."
          />
        </div>
        <p className="mt-4 text-xs text-ink-3">
          <Link
            href="/templates/timesheets-template.csv"
            className="text-status-blue hover:underline"
            download
          >
            Download timesheets-template.csv
          </Link>{' '}
          for the canonical column shape.
        </p>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <p className="text-xs text-ink-3">
        <Link href="/admin/import" className="hover:underline">
          Bulk import
        </Link>{' '}
        / Timesheets
      </p>
      <h1 className="mt-1 text-xl font-semibold text-ink">Timesheet CSV import</h1>
    </div>
  );
}
