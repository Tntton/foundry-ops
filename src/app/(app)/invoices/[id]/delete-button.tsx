'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { deleteDraftInvoice, type InvoiceDeleteState } from './actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function DeleteDraftInvoiceButton({
  invoiceId,
  invoiceNumber,
}: {
  invoiceId: string;
  invoiceNumber: string;
}) {
  const bound = deleteDraftInvoice.bind(null, invoiceId);
  const [state, action] = useFormState<InvoiceDeleteState, FormData>(bound, { status: 'idle' });
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Delete draft
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete invoice {invoiceNumber}?</DialogTitle>
          <DialogDescription>
            Only draft / pending-approval invoices can be deleted. Lines, any pending
            approval, and any milestone linkage are cleaned up. The audit log records the
            deletion.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-3">
          {state.status === 'error' && (
            <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
              {state.message}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <DeleteSubmit />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? 'Deleting…' : 'Delete invoice'}
    </Button>
  );
}
