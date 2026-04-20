'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { archivePerson, reactivatePerson, type ArchiveState } from './actions';
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
}: {
  personId: string;
  personEmail: string;
  personName: string;
  isSelf: boolean;
}) {
  const bound = archivePerson.bind(null, personId);
  const [state, action] = useFormState<ArchiveState, FormData>(bound, { status: 'idle' });
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

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
        <Button variant="outline">Archive</Button>
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
        <form action={action} className="space-y-3">
          {state.status === 'error' && (
            <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
              {state.message}
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
