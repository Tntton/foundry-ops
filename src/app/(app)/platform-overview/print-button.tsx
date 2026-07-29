'use client';

import { Printer } from 'lucide-react';

/**
 * Print / Save-as-PDF trigger for the platform overview. The page's
 * print stylesheet (see page.tsx) hides the app chrome and switches to
 * landscape, so the browser's print dialog produces a clean one-page
 * access matrix. Carries `fh-no-print` so the button itself is dropped
 * from the printout.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="fh-no-print inline-flex h-8 items-center gap-2 rounded-md border border-line bg-surface-elev px-3 text-sm text-ink-2 hover:bg-surface-hover"
    >
      <Printer className="h-3.5 w-3.5" />
      Download PDF
    </button>
  );
}
