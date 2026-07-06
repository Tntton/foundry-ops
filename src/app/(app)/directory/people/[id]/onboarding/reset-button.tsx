'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { resetOnboardingForPerson } from '@/app/(app)/onboarding/actions';

/**
 * Super-admin only. Nulls Person.onboardingCompletedAt so the first-
 * login guide re-triggers on their next visit. Useful after a role
 * change (e.g. staff → manager) so the person sees the new tier's
 * guide, or when someone dismissed the tour before it made sense.
 */
export function ResetOnboardingButton({ personId }: { personId: string }) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function run() {
    startTransition(async () => {
      await resetOnboardingForPerson(personId);
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={run} disabled={pending}>
        {pending ? 'Resetting' : 'Reset onboarding'}
      </Button>
      {done && (
        <span className="text-xs text-status-green">Reset. Guide will show on their next visit.</span>
      )}
    </div>
  );
}
