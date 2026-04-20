'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import {
  archivePerson,
  deletePerson,
  reactivatePerson,
  type ArchiveState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function ArchivePersonButton({
  personId,
  personEmail,
  personName,
  isSelf,
  canDelete,
  deleteBlockers,
}: {
  personId: string;
  personEmail: string;
  personName: string;
  isSelf: boolean;
  canDelete: boolean;
  deleteBlockers: string[];
}) {
  const archiveBound = archivePerson.bind(null, personId);
  const deleteBound = deletePerson.bind(null, personId);
  const [archiveState, archiveAction] = useFormState<ArchiveState, FormData>(archiveBound, {
    status: 'idle',
  });
  const [deleteState, deleteAction] = useFormState<ArchiveState, FormData>(deleteBound, {
    status: 'idle',
  });
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const isEmpty = deleteBlockers.length === 0;

  if (isSelf) {
    return (
      <Button variant="outline" disabled title="You cannot archive yourself">
        Archive
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Archive…</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive {personName}?</DialogTitle>
          <DialogDescription>
            Sets the end date and hides them from default Directory views. Historical
            records (timesheets, expenses, invoices, audit) are preserved and still reference
            this profile. Re-activate any time via the same profile page.
            <br />
            <br />
            To confirm, type <span className="font-mono text-ink">{personEmail}</span> below.
          </DialogDescription>
        </DialogHeader>
        <form action={archiveAction} className="space-y-3">
          {archiveState.status === 'error' && (
            <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
              {archiveState.message}
            </div>
          )}
          <label className="block space-y-1 text-sm">
            <span className="text-ink-3">
              Email confirmation <span className="text-status-red">*</span>
            </span>
            <Input
              name="confirmEmail"
              required
              autoComplete="off"
              placeholder={personEmail}
              className="font-mono"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-ink-3">End date (defaults to today)</span>
            <Input name="endDate" type="date" defaultValue={today} className="max-w-[200px]" />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <ArchiveSubmit />
          </DialogFooter>
        </form>

        {canDelete && (
          <div className="mt-4 space-y-3 rounded-md border border-status-red bg-status-red-soft/30 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-status-red">
              Danger zone — permanent delete
            </div>
            {isEmpty ? (
              <>
                <p className="text-sm text-ink-2">
                  This person has no timesheets, expenses, owned clients/projects, deals,
                  approvals, or audit events. They can be permanently deleted. Their M365
                  account will be disabled as a best-effort.
                </p>
                <form action={deleteAction} className="space-y-3">
                  {deleteState.status === 'error' && (
                    <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
                      {deleteState.message}
                    </div>
                  )}
                  <label className="block space-y-1 text-sm">
                    <span className="text-ink-3">
                      Re-type email to delete{' '}
                      <span className="font-mono text-ink">{personEmail}</span>
                    </span>
                    <Input
                      name="confirmEmail"
                      required
                      autoComplete="off"
                      placeholder={personEmail}
                      className="font-mono"
                    />
                  </label>
                  <DeleteSubmit />
                </form>
              </>
            ) : (
              <p className="text-sm text-ink-2">
                This person can&apos;t be permanently deleted — they&apos;ve touched{' '}
                <span className="text-ink">{deleteBlockers.join(', ')}</span>. Archive
                instead.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ArchiveSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? 'Archiving…' : 'Archive'}
    </Button>
  );
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending} className="w-full">
      {pending ? 'Deleting…' : 'Delete permanently'}
    </Button>
  );
}

export function ReactivatePersonButton({ personId }: { personId: string }) {
  const bound = reactivatePerson.bind(null, personId);
  const [state, action] = useFormState<ArchiveState, FormData>(bound, { status: 'idle' });

  return (
    <form action={action} className="inline-block">
      {state.status === 'error' && (
        <span className="mr-2 text-xs text-status-red">{state.message}</span>
      )}
      <ReactivateSubmit />
    </form>
  );
}

function ReactivateSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? 'Reactivating…' : 'Reactivate'}
    </Button>
  );
}
