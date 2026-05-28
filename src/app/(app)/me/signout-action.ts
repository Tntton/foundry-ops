'use server';

import { signOut } from '@/server/auth';

/**
 * Sign the current user out and bounce them back to the auth landing.
 * `signOut` already clears the session cookie + revokes the JWT; the
 * `redirectTo` param tells NextAuth where to land afterwards.
 *
 * Used by the topbar user-menu and the "Sign out" button on /me. Server
 * action so we never expose the auth token to the client.
 */
export async function signOutAction() {
  await signOut({ redirectTo: '/api/auth/signin' });
}
