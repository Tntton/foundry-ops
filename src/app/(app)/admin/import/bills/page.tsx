import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { readBills } from '@/server/imports/cache';
import { CsvDropzone } from '../_components/csv-dropzone';
import { BillsPreviewView } from './preview';
import { parseBillsCsv } from './actions';

type SearchParams = {
  stage?: string;
  token?: string;
  committed?: string;
  inserted?: string;
  skipped?: string;
  rejected?: string;
};

export default async function BillsImportPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'bill.create')) notFound();

  if (searchParams.stage === 'preview' && searchParams.token) {
    const preview = readBills(session.person.id, searchParams.token);
    if (!preview) {
      return (
        <div className="space-y-4">
          <Header />
          <div className="rounded-md border border-status-red bg-status-red-soft px-4 py-3 text-sm text-status-red">
            Preview expired or not found. Re-upload the file.
          </div>
          <Link href="/admin/import/bills" className="text-sm text-status-blue hover:underline">
            ← Back to upload
          </Link>
        </div>
      );
    }
    return <BillsPreviewView preview={preview} token={searchParams.token} />;
  }

  const justCommitted = searchParams.committed === '1';
  return (
    <div className="space-y-6">
      <Header />
      {justCommitted && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-4 py-3 text-sm text-status-green">
          Import committed — {searchParams.inserted ?? '0'} inserted ·{' '}
          {searchParams.skipped ?? '0'} duplicates skipped ·{' '}
          {searchParams.rejected ?? '0'} rejected. View entries in{' '}
          <Link href="/bills" className="font-medium underline">/bills</Link>.
        </div>
      )}
      <div className="rounded-lg border border-line bg-card p-5">
        <h2 className="text-sm font-semibold text-ink">Upload a bills CSV</h2>
        <p className="mt-1 text-xs text-ink-3">
          Historical vendor invoices land in <span className="font-mono">status=&apos;paid&apos;</span>,
          skipping the manual review queue. Rows are tagged to a project when a
          <span className="font-mono"> projectCode</span> matches; otherwise they land as OPEX. Existing bills with
          the same supplier + invoice number are flagged as duplicates and skipped by default.
        </p>
        <div className="mt-4">
          <CsvDropzone
            parseAction={parseBillsCsv}
            redirectTo="/admin/import/bills"
            helpText="CSV with one row per bill. Required: supplierName, issueDate, dueDate, amountTotalDollars, gstDollars, category."
          />
        </div>
        <p className="mt-4 text-xs text-ink-3">
          <Link
            href="/templates/bills-template.csv"
            className="text-status-blue hover:underline"
            download
          >
            Download bills-template.csv
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
          Data imports
        </Link>{' '}
        / Bills
      </p>
      <h1 className="mt-1 text-xl font-semibold text-ink">Bills CSV import</h1>
    </div>
  );
}
