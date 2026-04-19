import { redirect } from 'next/navigation';
import { signIn } from '@/server/auth';

export const dynamic = 'force-dynamic';

export default async function VerifyMagicLinkPage({
  searchParams,
}: {
  searchParams: { token?: string; callbackUrl?: string };
}) {
  const token = searchParams.token;
  const callbackUrl = searchParams.callbackUrl ?? '/';

  if (!token) {
    return (
      <main className="mx-auto max-w-lg p-12">
        <h1 className="mb-4 text-2xl font-semibold">Invalid link</h1>
        <p className="text-ink-2">
          This sign-in link is missing a token. Request a new one from your sign-in email.
        </p>
      </main>
    );
  }

  try {
    await signIn('magic-link', {
      token,
      redirect: false,
    });
  } catch (err) {
    console.error('[auth/magic-link/verify] signIn failed:', err);
    return (
      <main className="mx-auto max-w-lg p-12">
        <h1 className="mb-4 text-2xl font-semibold">Link invalid or expired</h1>
        <p className="text-ink-2">
          This sign-in link has expired or already been used. Request a fresh one and try
          again.
        </p>
      </main>
    );
  }

  redirect(callbackUrl);
}
