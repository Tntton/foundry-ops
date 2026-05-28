'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { toggleRebillable, type RebillableState } from '@/server/rebillable';

const initial: RebillableState = { status: 'idle' };

/**
 * Per-row Rebillable pill that doubles as a form. Click toggles the flag;
 * if the cost has already been forwarded to a client invoice, the toggle
 * is locked and shows the destination invoice instead. The Payables and
 * Reimbursables tables embed one of these per row.
 */
export function RebillableToggle({
  kind,
  id,
  rebillable,
  rebilledOnInvoiceId,
  hasProject,
}: {
  kind: 'bill' | 'expense';
  id: string;
  rebillable: boolean;
  rebilledOnInvoiceId: string | null;
  hasProject: boolean;
}) {
  const [state, action] = useFormState(toggleRebillable, initial);
  // Optimistic display — once the action returns, prefer the server's
  // canonical answer; until then mirror the prop.
  const current =
    state.status === 'success' ? state.rebillable : rebillable;

  if (rebilledOnInvoiceId) {
    return (
      <span
        title={`Forwarded to invoice ${rebilledOnInvoiceId}`}
        className="rounded-full border border-line bg-status-blue-soft px-2 py-0.5 text-[10px] font-medium text-status-blue"
      >
        ✓ Billed to client
      </span>
    );
  }

  return (
    <form action={action} className="inline-flex flex-col items-end gap-0.5">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="rebillable" value={current ? '0' : '1'} />
      <ToggleButton current={current} disabled={!hasProject && !current} />
      {state.status === 'error' && (
        <span className="text-[10px] text-status-red">{state.message}</span>
      )}
    </form>
  );
}

function ToggleButton({
  current,
  disabled,
}: {
  current: boolean;
  disabled: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      title={
        disabled
          ? 'Tag a project first — only project costs can be rebilled.'
          : current
            ? 'Click to unmark — cost will not be forwarded to a client invoice'
            : 'Click to mark — cost will be suggested on the next client invoice'
      }
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
        current
          ? 'border-status-amber bg-status-amber-soft text-status-amber hover:bg-status-amber-soft/70'
          : disabled
            ? 'border-line bg-surface-subtle text-ink-4 cursor-not-allowed'
            : 'border-line bg-card text-ink-3 hover:bg-surface-hover hover:text-ink'
      }`}
    >
      {pending ? '…' : current ? '↪ Rebillable' : '+ Mark rebillable'}
    </button>
  );
}
