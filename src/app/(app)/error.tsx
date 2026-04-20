'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app/error]', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-12">
      <h1 className="text-xl font-semibold text-ink">Something went wrong.</h1>
      <p className="text-sm text-ink-2">
        We hit an unexpected error rendering this page. The team&apos;s been logged; try
        again, and if it keeps happening send a screenshot with the error digest below.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-ink-3">digest: {error.digest}</p>
      )}
      <div className="flex gap-2">
        <Button onClick={() => reset()}>Try again</Button>
        <Button asChild variant="ghost">
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}
