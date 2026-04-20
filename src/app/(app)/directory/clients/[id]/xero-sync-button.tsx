'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { syncClientXero, type XeroSyncState } from './actions';
import { Button } from '@/components/ui/button';

export function XeroSyncClientButton({
  clientId,
  hasContactId,
}: {
  clientId: string;
  hasContactId: boolean;
}) {
  const bound = syncClientXero.bind(null, clientId);
  const [state, action] = useFormState<XeroSyncState, FormData>(bound, { status: 'idle' });
  return (
    <form action={action} className="inline-flex flex-col items-start gap-1">
      <SyncButton hasContactId={hasContactId} />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message}</p>
      )}
    </form>
  );
}

function SyncButton({ hasContactId }: { hasContactId: boolean }) {
  const { pending } = useFormStatus();
  const label = hasContactId ? 'Re-sync to Xero' : 'Sync to Xero';
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Syncing…' : label}
    </Button>
  );
}
