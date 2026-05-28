'use client';

import { useFormState, useFormStatus } from 'react-dom';
import {
  archiveClient,
  unarchiveClient,
  type ClientArchiveState,
} from './actions';
import { Button } from '@/components/ui/button';

export function ClientArchiveControls({
  clientId,
  isArchived,
}: {
  clientId: string;
  isArchived: boolean;
}) {
  if (isArchived) return <UnarchiveForm clientId={clientId} />;
  return <ArchiveForm clientId={clientId} />;
}

function ArchiveForm({ clientId }: { clientId: string }) {
  const bound = archiveClient.bind(null, clientId);
  const [state, action] = useFormState<ClientArchiveState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action as unknown as (fd: FormData) => void}>
      <Archive />
      {state.status === 'error' && (
        <p className="mt-1 text-xs text-status-red">{state.message}</p>
      )}
    </form>
  );
}

function Archive() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={(e) => {
        if (
          !confirm(
            'Archive this client? They disappear from the active directory but all data stays.',
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      {pending ? 'Archiving…' : 'Archive client'}
    </Button>
  );
}

function UnarchiveForm({ clientId }: { clientId: string }) {
  const bound = unarchiveClient.bind(null, clientId);
  const [state, action] = useFormState<ClientArchiveState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action as unknown as (fd: FormData) => void}>
      <Unarchive />
      {state.status === 'error' && (
        <p className="mt-1 text-xs text-status-red">{state.message}</p>
      )}
    </form>
  );
}

function Unarchive() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Restoring…' : 'Restore from archive'}
    </Button>
  );
}
