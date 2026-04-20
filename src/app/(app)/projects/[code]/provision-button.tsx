'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { provisionSharePoint, type ProvisionState } from './actions';
import { Button } from '@/components/ui/button';

export function ProvisionSharePointButton({ projectCode }: { projectCode: string }) {
  const bound = provisionSharePoint.bind(null, projectCode);
  const [state, action] = useFormState<ProvisionState, FormData>(bound, { status: 'idle' });

  return (
    <form action={action} className="flex flex-col items-center gap-2">
      <ProvisionButton />
      {state.status === 'error' && (
        <p className="text-xs text-status-red">{state.message}</p>
      )}
      {state.status === 'success' && (
        <p className="text-xs text-status-green">{state.message} Refreshing…</p>
      )}
    </form>
  );
}

function ProvisionButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? 'Provisioning…' : 'Provision SharePoint folder'}
    </Button>
  );
}
