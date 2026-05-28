'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { finaliseInvoice } from './actions';

/**
 * Triggers `window.print()` to open the native print dialog (which
 * doubles as "Save as PDF") and — on the first click — fires the
 * `finaliseInvoice` server action to record that the tax invoice has
 * been generated. Subsequent clicks still print but don't overwrite
 * the original finalisation timestamp.
 */
export function PrintButtonClient({
  invoiceId,
  alreadyFinalised,
}: {
  invoiceId: string;
  alreadyFinalised: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [finalised, setFinalised] = useState(alreadyFinalised);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    // Trigger the browser print dialog first — it opens immediately
    // off the user gesture, while the action records in parallel.
    if (typeof window !== 'undefined') window.print();
    if (finalised) return;
    startTransition(async () => {
      const result = await finaliseInvoice(invoiceId);
      if (result.status === 'error') setError(result.message);
      else setFinalised(true);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-status-red">{error}</span>}
      <Button type="button" size="sm" onClick={handleClick} disabled={pending}>
        {pending
          ? 'Recording…'
          : finalised
            ? 'Download as PDF'
            : 'Finalise & download PDF'}
      </Button>
    </div>
  );
}
