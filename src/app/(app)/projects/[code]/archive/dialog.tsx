'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import {
  archiveProject,
  deleteProject,
  reactivateProject,
  type ProjectArchiveState,
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

export function ArchiveProjectButton({
  projectId,
  projectCode,
  projectName,
  deleteBlockers,
  canDelete,
}: {
  projectId: string;
  projectCode: string;
  projectName: string;
  deleteBlockers: string[]; // empty array = no FK children, delete is safe
  canDelete: boolean;
}) {
  const archiveBound = archiveProject.bind(null, projectId);
  const deleteBound = deleteProject.bind(null, projectId);
  const [archiveState, archiveAction] = useFormState<ProjectArchiveState, FormData>(
    archiveBound,
    { status: 'idle' },
  );
  const [deleteState, deleteAction] = useFormState<ProjectArchiveState, FormData>(
    deleteBound,
    { status: 'idle' },
  );
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const isEmpty = deleteBlockers.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Archive…</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive {projectCode} {projectName}?</DialogTitle>
          <DialogDescription>
            Archive sets stage to <span className="font-mono">archived</span>, stamps an
            actual-end date, and hides the project from default Projects views. Historical
            records (invoices, bills, expenses, timesheets, audit) stay intact. Reactivate
            any time from the same page.
            <br />
            <br />
            To confirm, type the project code{' '}
            <span className="font-mono text-ink">{projectCode}</span> below.
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
              Code confirmation <span className="text-status-red">*</span>
            </span>
            <Input
              name="confirmCode"
              required
              autoComplete="off"
              placeholder={projectCode}
              className="font-mono uppercase"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-ink-3">Actual end date (defaults to today)</span>
            <Input
              name="actualEndDate"
              type="date"
              defaultValue={today}
              className="max-w-[200px]"
            />
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
                  This project has no invoices, bills, expenses, timesheets, or converted
                  deals. It can be permanently deleted. Team, milestones, and risks will
                  cascade. SharePoint folders + Xero tracking options are <em>not</em>{' '}
                  removed automatically.
                </p>
                <form action={deleteAction} className="space-y-3">
                  {deleteState.status === 'error' && (
                    <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
                      {deleteState.message}
                    </div>
                  )}
                  <label className="block space-y-1 text-sm">
                    <span className="text-ink-3">
                      Re-type code to delete{' '}
                      <span className="font-mono text-ink">{projectCode}</span>
                    </span>
                    <Input
                      name="confirmCode"
                      required
                      autoComplete="off"
                      placeholder={projectCode}
                      className="font-mono uppercase"
                    />
                  </label>
                  <DeleteSubmit />
                </form>
              </>
            ) : (
              <p className="text-sm text-ink-2">
                This project can&apos;t be permanently deleted — it still has{' '}
                <span className="text-ink">{deleteBlockers.join(', ')}</span>. Archive
                instead, or remove the blocking records first.
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
      {pending ? 'Archiving…' : 'Archive project'}
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

export function ReactivateProjectButton({ projectId }: { projectId: string }) {
  const bound = reactivateProject.bind(null, projectId);
  const [state, action] = useFormState<ProjectArchiveState, FormData>(bound, {
    status: 'idle',
  });

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
