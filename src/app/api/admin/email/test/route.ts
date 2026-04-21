import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { sendEmail, emailConfigured, EmailError } from '@/server/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TestSendSchema = z.object({
  to: z.string().email(),
});

/**
 * Admin-only: sends a tiny diagnostic email to the given address. Verifies the
 * RESEND_API_KEY + EMAIL_FROM pair without triggering any workflow-facing
 * emails. Returns 503 if Resend isn't configured.
 *
 * Example:
 *   curl -X POST /api/admin/email/test \
 *     -H 'content-type: application/json' \
 *     -d '{"to":"trung@foundry.health"}'
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'integration.manage')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (!emailConfigured()) {
    return NextResponse.json(
      {
        error: 'Email not configured',
        hint: 'Set RESEND_API_KEY and EMAIL_FROM in the env.',
      },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = TestSendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body — need {to: email}' }, { status: 400 });
  }

  try {
    const result = await sendEmail({
      to: parsed.data.to,
      subject: 'Foundry Ops — email diagnostic',
      text:
        'This is a diagnostic from Foundry Ops.\n\n' +
        'If you received it, the Resend API key + sender domain are working.\n' +
        'Sent at ' +
        new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, resendId: result.id });
  } catch (err) {
    if (err instanceof EmailError) {
      return NextResponse.json(
        { error: err.code, detail: err.message },
        { status: err.code === 'not_configured' ? 503 : 502 },
      );
    }
    return NextResponse.json({ error: 'unknown' }, { status: 500 });
  }
}
