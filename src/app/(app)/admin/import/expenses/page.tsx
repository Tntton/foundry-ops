import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { readExpenses } from '@/server/imports/cache';
import { CsvDropzone } from '../_components/csv-dropzone';
import { ExpensesPreviewView } from './preview';
import { parseExpensesCsv } from './actions';

type SearchParams = {
  stage?: string;
  token?: string;
  committed?: string;
  inserted?: string;
  rejected?: string;
};

export default async function ExpensesImportPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'expense.approve.under_2k')) notFound();

  if (searchParams.stage === 'preview' && searchParams.token) {
    const preview = readExpenses(session.person.id, searchParams.token);
    if (!preview) {
      return (
        <div className="space-y-4">
          <Header />
          <div className="rounded-md border border-status-red bg-status-red-soft px-4 py-3 text-sm text-status-red">
            Preview expired or not found. Re-upload the file.
          </div>
          <Link href="/admin/import/expenses" className="text-sm text-status-blue hover:underline">
            ← Back to upload
          </Link>
        </div>
      );
    }
    return <ExpensesPreviewView preview={preview} token={searchParams.token} />;
  }

  const justCommitted = searchParams.committed === '1';
  return (
    <div className="space-y-6">
      <Header />
      {justCommitted && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-4 py-3 text-sm text-status-green">
          Import committed — {searchParams.inserted ?? '0'} inserted ·{' '}
          {searchParams.rejected ?? '0'} rejected. View entries in{' '}
          <Link href="/expenses" className="font-medium underline">/expenses</Link>.
        </div>
      )}
      <div className="rounded-lg border border-line bg-card p-5">
        <h2 className="text-sm font-semibold text-ink">Upload an expenses CSV</h2>
        <p className="mt-1 text-xs text-ink-3">
          Historical expense claims land in <span className="font-mono">status=&apos;approved&apos;</span> with you
          as the approver, so they skip the manual approval queue. Rows are tagged to a
          project when a <span className="font-mono">projectCode</span> matches; otherwise they land
          as OPEX. Rows without a matching <span className="font-mono">personEmail</span> are
          rejected.
        </p>
        <div className="mt-4">
          <CsvDropzone
            parseAction={parseExpensesCsv}
            redirectTo="/admin/import/expenses"
            helpText="CSV with one row per expense. Required: personEmail, date, amountTotalDollars, gstDollars, category, description."
          />
        </div>
        <p className="mt-4 text-xs text-ink-3">
          <Link
            href="/templates/expenses-template.csv"
            className="text-status-blue hover:underline"
            download
          >
            Download expenses-template.csv
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
        / Expenses
      </p>
      <h1 className="mt-1 text-xl font-semibold text-ink">Expenses CSV import</h1>
    </div>
  );
}
