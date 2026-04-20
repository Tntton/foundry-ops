'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { deleteClient, type ClientDeleteState } from './actions';
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

export function DeleteClientButton({
  clientId,
  clientCode,
  clientName,
  deleteBlockers,
}: {
  clientId: string;
  clientCode: string;
  clientName: string;
  deleteBlockers: string[];
}) {
  const bound = deleteClient.bind(null, clientId);
  const [state, action] = useFormState<ClientDeleteState, FormData>(bound, { status: 'idle' });
  const [open, setOpen] = useState(false);
  const isEmpty = deleteBlockers.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Delete…</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {clientCode} {clientName}?</DialogTitle>
          <DialogDescription>
            {isEmpty
              ? 'This client has no projects, deals, or invoices. Delete is permanent. The Xero contact (if any) stays in Xero.'
              : `This client still has ${deleteBlockers.join(', ')}. Delete is blocked — remove those records first.`}
            <br />
            <br />
            {isEmpty && (
              <>
                To confirm, type the client code{' '}
                <span className="font-mono text-ink">{clientCode}</span> below.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {isEmpty ? (
          <form action={action} className="space-y-3">
            {state.status === 'error' && (
              <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
                {state.message}
              </div>
            )}
            <label className="block space-y-1 text-sm">
              <span className="text-ink-3">
                Code confirmation <span className="text-status-red">*</span>
              </span>
              <Input
                name="confirmCode"
                required
                autoComplete="off"
                placeholder={clientCode}
                className="font-mono uppercase"
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <DeleteSubmit />
            </DialogFooter>
          </form>
        ) : (
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? 'Deleting…' : 'Delete client'}
    </Button>
  );
}
