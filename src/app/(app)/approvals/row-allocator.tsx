'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useRef, useState } from 'react';
import {
  quickAllocateBillFromQueue,
  type QuickAllocateState,
} from './actions';
import type {
  ApprovalProjectOption,
  ApprovalPersonOption,
} from './bulk-queue';

/**
 * Inline allocator that sits under each pending **bill** row in the
 * /approvals queue. Two compact pickers (User + Project) that
 * auto-save on change — no Approve commit required.
 *
 * Auto-save fires by calling `form.requestSubmit()` from each
 * picker's onChange. React's server-action call-path runs the bound
 * action, returns a `QuickAllocateState`, and we render the latest
 * outcome inline ("Saved" / error message).
 *
 * Rendered for admin (super_admin / admin) only — the bulk-queue
 * decides whether to mount this based on `canOverrideAllocation`.
 */
export function QueueRowAllocator({
  approvalId,
  initialProjectId,
  initialProjectCode,
  initialProjectName,
  initialAttributedToPersonId,
  projectOptions,
  personOptions,
}: {
  approvalId: string;
  initialProjectId: string | null;
  /** Current project's code + name. Used to pin a "(current)" entry
   *  in the picker when the row is tagged to a project that's been
   *  filtered out (FHB000 / FHO000). */
  initialProjectCode?: string | null;
  initialProjectName?: string | null;
  initialAttributedToPersonId: string | null;
  projectOptions: ApprovalProjectOption[];
  personOptions: ApprovalPersonOption[];
}) {
  const boundAction = quickAllocateBillFromQueue.bind(null, approvalId);
  const [state, action] = useFormState<QuickAllocateState, FormData>(
    boundAction,
    { status: 'idle' },
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [projectId, setProjectId] = useState<string>(initialProjectId ?? '');
  const [attributedToPersonId, setAttributedToPersonId] = useState<string>(
    initialAttributedToPersonId ?? '',
  );

  // Pin the row's current project as a "(current)" option when it's
  // not in the visible options (i.e. tagged to FHB000 / FHO000). Stops
  // the controlled-select value mismatching its options.
  const currentMissing =
    initialProjectId !== null &&
    !projectOptions.some((p) => p.id === initialProjectId);

  return (
    <form
      ref={formRef}
      action={action}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
    >
      <label className="flex items-center gap-1.5">
        <span className="text-ink-3">User</span>
        <select
          name="attributedToPersonId"
          value={attributedToPersonId}
          onChange={(e) => {
            setAttributedToPersonId(e.target.value);
            formRef.current?.requestSubmit();
          }}
          className="h-7 max-w-[200px] rounded-md border border-line bg-surface-elev px-2 text-xs text-ink"
        >
          <option value="">— No one attributed —</option>
          {personOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.firstName} {p.lastName}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-ink-3">Project</span>
        <select
          name="projectId"
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            formRef.current?.requestSubmit();
          }}
          className="h-7 max-w-[260px] rounded-md border border-line bg-surface-elev px-2 text-xs text-ink"
        >
          <option value="">— OPEX (no project) —</option>
          {currentMissing && initialProjectId && (
            <option value={initialProjectId}>
              (current) {initialProjectCode ?? '?'}
              {initialProjectName ? ` — ${initialProjectName}` : ''}
            </option>
          )}
          {projectOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
      </label>

      <SaveStatus state={state} />
    </form>
  );
}

/**
 * Inline pending/saved/error indicator. useFormStatus gives us the
 * pending flag scoped to the surrounding `<form>`, so the spinner
 * fires for the picker the admin just changed even when two pickers
 * are in flight back-to-back.
 */
function SaveStatus({ state }: { state: QuickAllocateState }) {
  const { pending } = useFormStatus();
  if (pending) {
    return <span className="text-[11px] text-ink-3">Saving…</span>;
  }
  if (state.status === 'success' && state.message !== 'No changes.') {
    return <span className="text-[11px] text-status-green">✓ {state.message}</span>;
  }
  if (state.status === 'error') {
    return <span className="text-[11px] text-status-red">{state.message}</span>;
  }
  return null;
}
