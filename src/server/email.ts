import { Resend } from 'resend';
import { optionalEnv, requireEnv } from '@/server/env';

export type EmailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export class EmailError extends Error {
  constructor(
    public readonly code: 'not_configured' | 'send_failed',
    message: string,
  ) {
    super(message);
    this.name = 'EmailError';
  }
}

/**
 * Returns true when Resend is usable (both RESEND_API_KEY and EMAIL_FROM set).
 * Use from feature flags — never silently no-op inside send().
 */
export function emailConfigured(): boolean {
  return Boolean(optionalEnv('RESEND_API_KEY') && optionalEnv('EMAIL_FROM'));
}

/**
 * Single send helper used by all transactional emails (magic-link today;
 * approval nudges / AR chase / payroll confirmations later). Throws
 * EmailError on any failure so callers decide whether to fail the action
 * or best-effort continue.
 */
export async function sendEmail(msg: EmailMessage): Promise<{ id: string | null }> {
  if (!emailConfigured()) {
    throw new EmailError(
      'not_configured',
      'RESEND_API_KEY / EMAIL_FROM not set — cannot send.',
    );
  }
  const resend = new Resend(requireEnv('RESEND_API_KEY'));
  const from = requireEnv('EMAIL_FROM');
  try {
    const { data, error } = await resend.emails.send({
      from: `Foundry Ops <${from}>`,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    });
    if (error) {
      throw new EmailError('send_failed', `Resend error: ${error.message}`);
    }
    return { id: data?.id ?? null };
  } catch (err) {
    if (err instanceof EmailError) throw err;
    throw new EmailError('send_failed', (err as Error).message);
  }
}
