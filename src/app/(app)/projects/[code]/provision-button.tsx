'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { provisionSharePoint, type ProvisionState } from './actions';
import { Button } from '@/components/ui/button';

export function ProvisionSharePointButton({
  projectCode,
  hasExisting = false,
}: {
  projectCode: string;
  hasExisting?: boolean;
}) {
  const bound = provisionSharePoint.bind(null, projectCode);
  const [state, action] = useFormState<ProvisionState, FormData>(bound, { status: 'idle' });

  return (
    <form action={action} className="flex flex-col items-center gap-2">
      <ProvisionButton hasExisting={hasExisting} />
      {hasExisting && (
        <p className="text-[11px] text-ink-4">
          Re-runs are idempotent — if the folder still exists in SharePoint, nothing is
          copied. Delete the folder in SharePoint first to force a fresh template copy.
        </p>
      )}
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message} Refreshing…</p>
      )}
    </form>
  );
}

function ProvisionButton({ hasExisting }: { hasExisting: boolean }) {
  const { pending } = useFormStatus();
  const idle = hasExisting ? 'Re-provision SharePoint folder' : 'Provision SharePoint folder';
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Provisioning…' : idle}
    </Button>
  );
}
