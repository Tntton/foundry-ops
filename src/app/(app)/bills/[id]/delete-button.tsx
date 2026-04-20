'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import { deleteDraftBill, type BillDeleteState } from './actions';
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

export function DeleteDraftBillButton({
  billId,
  supplierName,
}: {
  billId: string;
  supplierName: string;
}) {
  const bound = deleteDraftBill.bind(null, billId);
  const [state, action] = useFormState<BillDeleteState, FormData>(bound, { status: 'idle' });
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete bill from {supplierName}?</DialogTitle>
          <DialogDescription>
            Only pending-review bills can be deleted. Any pending approval row is cleared;
            the audit log records the deletion.
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
      {pending ? 'Deleting…' : 'Delete bill'}
    </Button>
  );
}
