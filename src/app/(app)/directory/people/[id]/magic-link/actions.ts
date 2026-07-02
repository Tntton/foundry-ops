'use server';

import { headers } from 'next/headers';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { mintMagicLink, MagicLinkError } from '@/server/magic-link';
import { sendEmail, EmailError } from '@/server/email';

export type MagicLinkGenState =
  | { status: 'idle' }
  | { status: 'success'; url: string; expiresAt: string; emailStatus: 'sent' | 'failed'; emailError?: string }
  | { status: 'error'; message: string };

/**
 * Super-admin escape hatch — mint a magic link for a Person and both
 * email it AND surface the URL for copy/paste. The two channels are
 * independent: if Resend fails, the URL is still returned so the admin
 * can hand-deliver via WhatsApp / etc.
 *
 * Rate limits still apply (3 sends per email per hour). Every attempt
 * writes an AuditEvent so a stray super-admin can't quietly issue
 * multiple links.
 *
 * Return shape is a `useFormState` result — the calling client component
 * (magic-link-button.tsx) reads state.status to render.
 */
export async function generateMagicLinkForPerson(
  personId: string,
  _prev: MagicLinkGenState,
  _formData: FormData,
): Promise<MagicLinkGenState> {
  const session = await getSession();
  if (!session) {
    return { status: 'error', message: 'Not signed in.' };
  }
  if (!hasAnyRole(session, ['super_admin'])) {
    return { status: 'error', message: 'Super admin only.' };
  }

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  if (!person) {
    return { status: 'error', message: 'Person not found.' };
  }

  const h = headers();
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = h.get('user-agent') ?? null;

  let url: string;
  let expiresAt: Date;
  try {
    const minted = await mintMagicLink(person.email, { ip, userAgent });
    url = minted.url;
    expiresAt = minted.expiresAt;
  } catch (err) {
    if (err instanceof MagicLinkError && err.code === 'rate_limited') {
      return {
        status: 'error',
        message: 'Rate limit hit for this address (3 links per hour). Try again later.',
      };
    }
    console.error('[magic-link/generate] mint failed:', err);
    return { status: 'error', message: 'Failed to mint link.' };
  }

  // Email is best-effort. If it fails, we still return the URL so the
  // admin can deliver it another way. Failure is surfaced in the return.
  let emailStatus: 'sent' | 'failed' = 'sent';
  let emailError: string | undefined;
  try {
    await sendEmail({
      to: person.email,
      subject: 'Your Foundry Ops sign-in link',
      text: `A super-admin has issued you a sign-in link:\n\n${url}\n\nThis link is valid for 15 minutes and can only be used once. If you didn't expect it, ignore this email.`,
      html: `
        <div style="font-family:Helvetica Neue,Helvetica,Arial,sans-serif;max-width:560px;margin:40px auto;color:#1a1a17">
          <h1 style="font-size:20px;margin:0 0 16px">Sign in to Foundry Ops</h1>
          <p style="line-height:1.5;margin:0 0 24px">A super-admin has issued you a sign-in link. This link is valid for 15 minutes and can only be used once.</p>
          <p style="margin:0 0 32px">
            <a href="${url}" style="background:#688b71;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Sign in</a>
          </p>
          <p style="line-height:1.5;color:#8b8984;font-size:13px;margin:0">If the button doesn't work, paste this into your browser:<br/><span style="word-break:break-all">${url}</span></p>
          <p style="line-height:1.5;color:#8b8984;font-size:13px;margin:24px 0 0">If you didn't expect this, ignore this email.</p>
        </div>
      `,
    });
  } catch (err) {
    emailStatus = 'failed';
    emailError = err instanceof EmailError ? err.message : (err as Error).message;
    console.warn('[magic-link/generate] email delivery failed:', emailError);
  }

  // Audit — always, on the calling super-admin's actor id. The delta
  // captures who the link was for + email delivery status but NEVER the
  // raw URL / token (that would defeat the point of hashing).
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      actor: { type: 'person', id: session.person.id },
      action: 'issued_magic_link',
      entity: {
        type: 'Person',
        id: person.id,
        before: null,
        after: {
          recipient: person.email,
          expiresAt: expiresAt.toISOString(),
          emailStatus,
        },
      },
      source: 'web',
      ip,
      userAgent,
    });
  });

  return {
    status: 'success',
    url,
    expiresAt: expiresAt.toISOString(),
    emailStatus,
    ...(emailError ? { emailError } : {}),
  };
}
