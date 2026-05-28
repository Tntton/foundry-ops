'use client';

import { useFormState, useFormStatus } from 'react-dom';
import {
  archiveDeal,
  unarchiveDeal,
  deleteDeal,
  type DealUpdateState,
} from './actions';
import { Button } from '@/components/ui/button';

export function DealArchiveControls({
  dealId,
  isArchived,
  canDelete,
  hasLinkedProject,
}: {
  dealId: string;
  isArchived: boolean;
  canDelete: boolean;
  hasLinkedProject: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {isArchived ? (
        <UnarchiveButton dealId={dealId} />
      ) : (
        <ArchiveButton dealId={dealId} />
      )}
      {canDelete && !hasLinkedProject && <DeleteButton dealId={dealId} />}
    </div>
  );
}

function ArchiveButton({ dealId }: { dealId: string }) {
  const bound = archiveDeal.bind(null, dealId);
  const [state, action] = useFormState<DealUpdateState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action as unknown as (fd: FormData) => void}>
      <ArchiveSubmit />
      {state.status === 'error' && (
        <p className="mt-1 text-xs text-status-red">{state.message}</p>
      )}
    </form>
  );
}

function ArchiveSubmit() {
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
            'Archive this deal? It will be hidden from the pipeline but not deleted.',
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      {pending ? 'Archiving…' : 'Archive'}
    </Button>
  );
}

function UnarchiveButton({ dealId }: { dealId: string }) {
  const bound = unarchiveDeal.bind(null, dealId);
  const [state, action] = useFormState<DealUpdateState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action as unknown as (fd: FormData) => void}>
      <UnarchiveSubmit />
      {state.status === 'error' && (
        <p className="mt-1 text-xs text-status-red">{state.message}</p>
      )}
    </form>
  );
}

function UnarchiveSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Restoring…' : 'Restore from archive'}
    </Button>
  );
}

function DeleteButton({ dealId }: { dealId: string }) {
  const bound = deleteDeal.bind(null, dealId);
  const [state, action] = useFormState<DealUpdateState, FormData>(bound, {
    status: 'idle',
  });
  return (
    <form action={action as unknown as (fd: FormData) => void}>
      <DeleteSubmit />
      {state.status === 'error' && (
        <p className="mt-1 text-xs text-status-red">{state.message}</p>
      )}
    </form>
  );
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={(e) => {
        if (
          !confirm(
            'Permanently delete this deal? Audit trail is preserved but the deal row is gone for good.',
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      {pending ? 'Deleting…' : 'Delete permanently'}
    </Button>
  );
}
