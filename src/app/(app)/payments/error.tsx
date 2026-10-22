'use client';

export default function PaymentsError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-lg border border-status-red/40 bg-status-red-soft/30 px-6 py-12 text-center">
      <p className="text-sm font-medium text-status-red">
        The payments register couldn&apos;t be loaded.
      </p>
      <p className="mt-1 text-sm text-ink-3">Something went wrong. This has been logged.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink hover:bg-surface-hover"
      >
        Try again
      </button>
    </div>
  );
}
