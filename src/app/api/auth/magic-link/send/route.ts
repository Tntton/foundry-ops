import { NextResponse } from 'next/server';
import { z } from 'zod';
import { sendMagicLink, MagicLinkError } from '@/server/magic-link';

export const runtime = 'nodejs';

const Body = z.object({
  email: z.string().email().max(254),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = req.headers.get('user-agent') ?? null;

  try {
    await sendMagicLink(parsed.data.email, { ip, userAgent });
    // Generic success — don't reveal whether the email matches a Person.
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof MagicLinkError && err.code === 'rate_limited') {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    }
    console.error('[api/auth/magic-link/send] unexpected error:', err);
    // Still return a generic success to avoid enumeration leakage on transient failures.
    return NextResponse.json({ ok: true });
  }
}
