'use client';

import { useTransition, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toggleMailboxCursor } from './actions';

export function MailboxToggleButton({
  mailboxUpn,
  enabled,
}: {
  mailboxUpn: string;
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant={enabled ? 'outline' : 'default'}
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await toggleMailboxCursor({
              mailboxUpn,
              enabled: !enabled,
            });
            if (!res.ok) setError(res.error);
          });
        }}
      >
        {pending
          ? 'Saving…'
          : enabled
            ? 'Disable polling'
            : 'Enable polling'}
      </Button>
      {error && <span className="text-xs text-red">{error}</span>}
    </div>
  );
}
