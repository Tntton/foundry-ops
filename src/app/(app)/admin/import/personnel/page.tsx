import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { readPersonnel } from '@/server/imports/cache';
import { CsvDropzone } from '../_components/csv-dropzone';
import { PersonnelPreviewView } from './preview';
import { parsePersonnelCsv } from './actions';

type SearchParams = {
  stage?: string;
  token?: string;
  committed?: string;
  new?: string;
  updated?: string;
};

export default async function PersonnelImportPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'person.create')) notFound();

  // Preview stage — read the stashed parse result by token + user.
  if (searchParams.stage === 'preview' && searchParams.token) {
    const preview = readPersonnel(session.person.id, searchParams.token);
    if (!preview) {
      return (
        <div className="space-y-4">
          <Header />
          <div className="rounded-md border border-status-red bg-status-red-soft px-4 py-3 text-sm text-status-red">
            Preview expired or not found. Re-upload the file.
          </div>
          <Link href="/admin/import/personnel" className="text-sm text-status-blue hover:underline">
            ← Back to upload
          </Link>
        </div>
      );
    }
    return <PersonnelPreviewView preview={preview} token={searchParams.token} />;
  }

  // Commit-done banner.
  const justCommitted = searchParams.committed === '1';

  return (
    <div className="space-y-6">
      <Header />
      {justCommitted && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-4 py-3 text-sm text-status-green">
          Import committed — {searchParams.new ?? '0'} new ·{' '}
          {searchParams.updated ?? '0'} updated. View them in{' '}
          <Link href="/directory" className="font-medium underline">/directory</Link>.
        </div>
      )}
      <div className="rounded-lg border border-line bg-card p-5">
        <h2 className="text-sm font-semibold text-ink">Upload a personnel CSV</h2>
        <p className="mt-1 text-xs text-ink-3">
          Historical records land pre-populated. New persons are created if their
          email doesn&apos;t match an existing record; matching emails update the
          existing record.
        </p>
        <div className="mt-4">
          <CsvDropzone
            parseAction={parsePersonnelCsv}
            redirectTo="/admin/import/personnel"
            helpText="CSV with one row per Person. Required columns: email, firstName, lastName, band, level, employment, region, rateUnit, rateDollars, startDate."
          />
        </div>
        <p className="mt-4 text-xs text-ink-3">
          <Link
            href="/templates/personnel-template.csv"
            className="text-status-blue hover:underline"
            download
          >
            Download personnel-template.csv
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
        / Personnel
      </p>
      <h1 className="mt-1 text-xl font-semibold text-ink">Personnel CSV import</h1>
    </div>
  );
}
