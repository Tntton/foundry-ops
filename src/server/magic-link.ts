import { createHash, randomBytes } from 'node:crypto';
import { Resend } from 'resend';
import { prisma } from '@/server/db';
import { requireEnv, optionalEnv } from '@/server/env';

const TOKEN_BYTES = 32;
const TTL_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 3;

export class MagicLinkError extends Error {
  constructor(
    public readonly code:
      | 'rate_limited'
      | 'unknown_email'
      | 'invalid_token'
      | 'expired'
      | 'consumed'
      | 'send_failed',
    message: string,
  ) {
    super(message);
    this.name = 'MagicLinkError';
  }
}

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function getAppUrl(): string {
  return optionalEnv('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000';
}

/**
 * Create a magic link for the given email and send it via Resend.
 * Rate-limited to 3 sends per email per hour.
 * Does NOT reveal whether the email matches a Person — generic success response
 * protects against user enumeration. The verify step does the actual auth.
 */
export async function sendMagicLink(
  email: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  const normalised = email.toLowerCase().trim();

  const recentCount = await prisma.magicLink.count({
    where: {
      email: normalised,
      createdAt: { gte: new Date(Date.now() - RATE_LIMIT_WINDOW_MS) },
    },
  });
  if (recentCount >= RATE_LIMIT_MAX) {
    throw new MagicLinkError('rate_limited', `Too many requests for ${normalised}`);
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + TTL_MS);

  await prisma.magicLink.create({
    data: {
      email: normalised,
      tokenHash,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });

  const resend = new Resend(requireEnv('RESEND_API_KEY'));
  const from = requireEnv('EMAIL_FROM');
  const link = `${getAppUrl()}/auth/magic-link/verify?token=${encodeURIComponent(token)}`;

  const { error } = await resend.emails.send({
    from: `Foundry Ops <${from}>`,
    to: normalised,
    subject: 'Your Foundry Ops sign-in link',
    text: `Sign in to Foundry Ops:\n\n${link}\n\nThis link is valid for 15 minutes and can only be used once. If you didn't request it, you can ignore this email.`,
    html: `
      <div style="font-family:Helvetica Neue,Helvetica,Arial,sans-serif;max-width:560px;margin:40px auto;color:#1a1a17">
        <h1 style="font-size:20px;margin:0 0 16px">Sign in to Foundry Ops</h1>
        <p style="line-height:1.5;margin:0 0 24px">Click the button below to sign in. This link is valid for 15 minutes and can only be used once.</p>
        <p style="margin:0 0 32px">
          <a href="${link}" style="background:#688b71;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Sign in</a>
        </p>
        <p style="line-height:1.5;color:#8b8984;font-size:13px;margin:0">If the button doesn't work, paste this into your browser:<br/><span style="word-break:break-all">${link}</span></p>
        <p style="line-height:1.5;color:#8b8984;font-size:13px;margin:24px 0 0">If you didn't request this, you can ignore this email.</p>
      </div>
    `,
  });

  if (error) {
    throw new MagicLinkError('send_failed', `Resend error: ${error.message}`);
  }
}

export type VerifiedIdentity = {
  personId: string;
  email: string;
  firstName: string;
  lastName: string;
};

/**
 * Verify a magic-link token. On success, burns it (single-use) and returns
 * the Person it resolves to. Throws MagicLinkError on any failure.
 */
export async function verifyMagicLink(token: string): Promise<VerifiedIdentity> {
  if (!token) throw new MagicLinkError('invalid_token', 'Missing token');
  const tokenHash = hashToken(token);

  const link = await prisma.magicLink.findUnique({ where: { tokenHash } });
  if (!link) throw new MagicLinkError('invalid_token', 'Unknown token');
  if (link.consumedAt) throw new MagicLinkError('consumed', 'Link already used');
  if (link.expiresAt.getTime() < Date.now()) {
    throw new MagicLinkError('expired', 'Link expired');
  }

  // Person must pre-exist — contractors are onboarded via the Directory wizard (A2).
  const person = await prisma.person.findUnique({ where: { email: link.email } });
  if (!person) {
    // Burn the link anyway so retries fail the same way.
    await prisma.magicLink.update({
      where: { id: link.id },
      data: { consumedAt: new Date() },
    });
    throw new MagicLinkError('unknown_email', 'No account for this email');
  }

  // Burn the link (single-use) before returning.
  await prisma.magicLink.update({
    where: { id: link.id },
    data: { consumedAt: new Date() },
  });

  return {
    personId: person.id,
    email: person.email,
    firstName: person.firstName,
    lastName: person.lastName,
  };
}
