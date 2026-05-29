'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

const ACCEPT_EXT = ['.csv', '.tsv', '.txt'];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — well above the 5000-row hard cap

export type ParseResult = { ok: true; token: string } | { ok: false; message: string };

/**
 * Reusable file-drop zone for the personnel + timesheet import flows.
 * Wraps a hidden <input type=file> in a styled drag-and-drop region —
 * the file is read to text in the browser and handed to the server via
 * a plain async function (not a server action / formData) so the
 * response can carry the dry-run token back without forcing a redirect.
 */
export function CsvDropzone({
  parseAction,
  redirectTo,
  helpText,
  ctaLabel = 'Parse file',
}: {
  parseAction: (csvText: string, fileName: string) => Promise<ParseResult>;
  /** Path to redirect to on success — token appended as `?stage=preview&token=…`. */
  redirectTo: string;
  helpText: string;
  ctaLabel?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pickFile(f: File | null) {
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
    if (!ACCEPT_EXT.includes(ext)) {
      setError(`File must be one of ${ACCEPT_EXT.join(' / ')}. Got "${ext}".`);
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`File is ${(f.size / 1024 / 1024).toFixed(1)} MB — limit is ${MAX_BYTES / 1024 / 1024} MB.`);
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function submit() {
    if (!file) return;
    setError(null);
    const text = await file.text();
    startTransition(async () => {
      const result = await parseAction(text, file.name);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      const url = `${redirectTo}?stage=preview&token=${encodeURIComponent(result.token)}`;
      router.push(url);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const f = e.dataTransfer.files?.[0] ?? null;
          pickFile(f);
        }}
        className={
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition ' +
          (isDragging
            ? 'border-status-blue bg-status-blue-soft'
            : 'border-line bg-surface-subtle hover:border-status-blue hover:bg-status-blue-soft')
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_EXT.join(',')}
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-sm font-medium text-ink">
          {file ? file.name : 'Drop a CSV file here, or click to choose'}
        </p>
        <p className="mt-1 text-xs text-ink-3">{helpText}</p>
        {file && (
          <p className="mt-2 font-mono text-xs text-ink-3">
            {(file.size / 1024).toFixed(1)} KB
          </p>
        )}
      </label>
      {error && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {file && (
          <Button variant="ghost" type="button" onClick={() => pickFile(null)}>
            Clear
          </Button>
        )}
        <Button type="button" onClick={() => void submit()} disabled={!file || isPending}>
          {isPending ? 'Parsing…' : ctaLabel}
        </Button>
      </div>
    </div>
  );
}
