import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { isWhatsAppConfigured } from '@/server/integrations/whatsapp';
import { prisma } from '@/server/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { WhatsAppTestForm } from './form';

/**
 * WhatsApp integration test page — admin-only sandbox to verify
 * outbound messaging. Useful while Business Verification is pending
 * and Foundry is on Meta's test-number tier (limited to verified
 * recipient list). Once the Boost number is registered, this same
 * page lets ops sanity-check the channel without triggering a real
 * approval flow.
 */
export default async function WhatsAppAdminPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin'])) notFound();
  const configured = isWhatsAppConfigured();

  // Pre-fill recipient with the current user's whatsappNumber (set on
  // the Person row via /directory/people/[id]/edit). Falls back to
  // empty so the user can type any verified number.
  const me = session
    ? await prisma.person.findUnique({
        where: { id: session.person.id },
        select: { whatsappNumber: true },
      })
    : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">WhatsApp · test</h1>
        <p className="text-sm text-ink-3">
          Send a free-form text message to a verified recipient via the
          configured WhatsApp Business number. While Meta Business
          Verification is in review, only numbers added to the verified
          test-recipient list at developers.facebook.com will receive
          messages — everyone else returns an error from Meta.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Status:{' '}
            {configured ? (
              <span className="text-status-green">Configured</span>
            ) : (
              <span className="text-status-red">Env vars missing</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {configured ? (
            <WhatsAppTestForm defaultToNumber={me?.whatsappNumber ?? ''} />
          ) : (
            <p className="text-sm text-ink-3">
              Set WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID /
              WHATSAPP_VERIFY_TOKEN / WHATSAPP_APP_SECRET on Vercel,
              then redeploy.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
