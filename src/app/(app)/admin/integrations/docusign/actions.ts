'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { prisma } from '@/server/db';
import {
  saveDocuSignConnection,
  clearDocuSignConnection,
  stampDocuSignConsent,
} from '@/server/integrations/docusign';

export type ConnectDocuSignState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

/**
 * Strip a leading "Label: " prefix from pasted credentials —
 * mirrors the Navan + Uber connectors. Common UX failure mode
 * where admin copies the entire row from the DocuSign settings
 * page including the field label.
 */
function cleanCredential(raw: string): string {
  return raw
    .trim()
    .replace(/^[A-Za-z][A-Za-z0-9 ]+:\s*/u, '')
    .trim();
}

const ConnectSchema = z.object({
  integrationKey: z.string().trim().min(8).transform(cleanCredential),
  apiUserId: z.string().trim().min(8).transform(cleanCredential),
  accountId: z.string().trim().min(8).transform(cleanCredential),
  privateKeyPem: z
    .string()
    .min(200)
    .refine(
      (v) =>
        v.trim().startsWith('-----BEGIN') && v.trim().includes('PRIVATE KEY'),
      {
        message:
          'Doesn’t look like a PEM private key — make sure you pasted the BEGIN/END block in full.',
      },
    ),
  hmacSecret: z.string().trim().min(8),
  environment: z.enum(['demo', 'prod']),
});

export async function connectDocuSignAction(
  _prev: ConnectDocuSignState,
  formData: FormData,
): Promise<ConnectDocuSignState> {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  const parsed = ConnectSchema.safeParse({
    integrationKey: formData.get('integrationKey') ?? '',
    apiUserId: formData.get('apiUserId') ?? '',
    accountId: formData.get('accountId') ?? '',
    privateKeyPem: formData.get('privateKeyPem') ?? '',
    hmacSecret: formData.get('hmacSecret') ?? '',
    environment:
      (formData.get('environment') as string) === 'prod' ? 'prod' : 'demo',
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  try {
    await saveDocuSignConnection({
      integrationKey: parsed.data.integrationKey,
      apiUserId: parsed.data.apiUserId,
      accountId: parsed.data.accountId,
      privateKeyPem: parsed.data.privateKeyPem,
      hmacSecret: parsed.data.hmacSecret,
      environment: parsed.data.environment,
    });
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'connected',
        entity: { type: 'integration', id: 'docusign' },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[docusign.connect] failed:', err);
    return { status: 'error', message: 'Connect failed — see server logs.' };
  }
  revalidatePath('/admin/integrations');
  revalidatePath('/admin/integrations/docusign');
  return {
    status: 'success',
    message:
      'Connected. Now visit the consent URL below + click "I granted consent" to finish setup.',
  };
}

export type DisconnectDocuSignState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function disconnectDocuSignAction(
  _prev: DisconnectDocuSignState,
  _formData: FormData,
): Promise<DisconnectDocuSignState> {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  try {
    await clearDocuSignConnection();
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'disconnected',
        entity: { type: 'integration', id: 'docusign' },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[docusign.disconnect] failed:', err);
    return { status: 'error', message: 'Disconnect failed — see server logs.' };
  }
  revalidatePath('/admin/integrations');
  revalidatePath('/admin/integrations/docusign');
  return { status: 'success' };
}

export type ConsentStampState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

/**
 * Records that admin has completed the one-time JWT consent flow
 * on DocuSign's side. Not a verification — we can't programmatically
 * check whether consent was actually granted. The next JWT exchange
 * will fail with 'consent_required' if it wasn't, which is the
 * canonical signal.
 */
export async function stampConsentAction(
  _prev: ConsentStampState,
  _formData: FormData,
): Promise<ConsentStampState> {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  try {
    await stampDocuSignConsent();
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'consent_stamped',
        entity: { type: 'integration', id: 'docusign' },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[docusign.consent] failed:', err);
    return { status: 'error', message: 'Stamp failed — see server logs.' };
  }
  revalidatePath('/admin/integrations/docusign');
  return { status: 'success' };
}
