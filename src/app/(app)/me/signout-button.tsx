'use client';

import { useTransition } from 'react';
import { signOutAction } from './signout-action';
import { Button } from '@/components/ui/button';

/**
 * "Sign out" affordance for the bottom of /me. Mirrors the topbar
 * dropdown entry — there for users who don't think to look at the
 * top-right avatar menu.
 */
export function SignOutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <form
      action={() => {
        startTransition(async () => {
          await signOutAction();
        });
      }}
    >
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        className="border-status-red/40 text-status-red hover:bg-status-red-soft hover:text-status-red"
      >
        {pending ? 'Signing out…' : 'Sign out'}
      </Button>
    </form>
  );
}
