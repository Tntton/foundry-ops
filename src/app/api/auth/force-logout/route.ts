import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { signOut } from '@/server/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * One-click hard logout. Built after recurring "stuck in Entra login
 * loop after signing out" incidents (TT 2026-06-18) — the standard
 * /api/auth/signout sometimes leaves a half-state cookie that traps
 * the next /api/auth/signin call in a redirect loop.
 *
 * What this route does:
 *   1. Calls NextAuth's signOut() to clean the session record.
 *   2. Manually expires every known NextAuth + app cookie on this
 *      origin (both __Secure-* and unprefixed variants since the same
 *      browser may have visited via http during local dev).
 *   3. Redirects to /api/auth/signin so the user lands at a fresh sign
 *      with no residual state.
 *
 * Hit this URL directly when stuck: ops.foundry.health/api/auth/force-logout
 *
 * Does NOT clear Microsoft / login.microsoftonline.com cookies — those
 * are on a different origin and can only be cleared by the browser
 * directly. If a force-logout still loops, clearing those is the next
 * step (see /admin/reconcile docs for the manual recipe).
 */
const COOKIE_NAMES = [
  // NextAuth v5 (Auth.js) standard names — both prefixed and unprefixed
  // because some envs (local http) drop the __Secure- prefix.
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'authjs.csrf-token',
  '__Host-authjs.csrf-token',
  'authjs.callback-url',
  '__Secure-authjs.callback-url',
  'authjs.pkce.code_verifier',
  '__Secure-authjs.pkce.code_verifier',
  'authjs.state',
  '__Secure-authjs.state',
  'authjs.nonce',
  '__Secure-authjs.nonce',
  // Legacy next-auth v4 names — keep around in case anyone still has
  // a stale cookie from before the v5 upgrade.
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
  'next-auth.csrf-token',
  '__Host-next-auth.csrf-token',
  'next-auth.callback-url',
  '__Secure-next-auth.callback-url',
  // App-specific cookies the user might want reset alongside the auth
  // session. Commercials toggle is the only one today; add new ones
  // here as they appear.
  'fh_show_commercials',
] as const;

async function nuke(): Promise<NextResponse> {
  // Best-effort NextAuth signOut — ignored on failure because we'll
  // overwrite the cookies manually anyway. The redirect:false keeps
  // signOut from throwing a NEXT_REDIRECT in the route context.
  try {
    await signOut({ redirect: false });
  } catch {
    // ignore — the cookie sweep below is the real cleanup.
  }

  const jar = cookies();
  for (const name of COOKIE_NAMES) {
    // Belt + braces: delete() removes; set with maxAge=0 forces
    // expiration on browsers that don't honour delete cleanly.
    try {
      jar.delete(name);
    } catch {
      // some cookies are read-only via the route API; skip silently.
    }
    try {
      jar.set(name, '', { path: '/', maxAge: 0, expires: new Date(0) });
    } catch {
      // ignore
    }
  }

  // 303 So the browser switches to GET on the redirect target — sign-in
  // page should never be hit with POST.
  return NextResponse.redirect(new URL('/api/auth/signin', getOrigin()), {
    status: 303,
  });
}

function getOrigin(): string {
  return (
    process.env['NEXTAUTH_URL'] ??
    process.env['AUTH_URL'] ??
    'https://ops.foundry.health'
  );
}

export async function GET(): Promise<NextResponse> {
  return nuke();
}

export async function POST(): Promise<NextResponse> {
  return nuke();
}
