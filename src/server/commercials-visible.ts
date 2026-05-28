'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

/**
 * Commercial-values visibility toggle.
 *
 * Foundry uses /projects and /bd in team discussions where partners
 * don't want $ amounts flashing on the screen for everyone in the
 * room. Default state is HIDDEN — partners flip it on when reviewing
 * commercials in private, and off again before the team huddle.
 *
 * State lives in a cookie (server-readable) so the gate works for
 * server-rendered pages without round-tripping through searchParams.
 */

const COOKIE_NAME = 'fh_show_commercials';

export async function readCommercialsVisible(): Promise<boolean> {
  return cookies().get(COOKIE_NAME)?.value === '1';
}

export async function setCommercialsVisible(visible: boolean, pathToRevalidate?: string): Promise<void> {
  const jar = cookies();
  if (visible) {
    jar.set(COOKIE_NAME, '1', {
      httpOnly: false, // readable in case a client component ever wants it
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  } else {
    jar.delete(COOKIE_NAME);
  }
  if (pathToRevalidate) revalidatePath(pathToRevalidate);
}
