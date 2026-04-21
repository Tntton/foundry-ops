import type { PayRunType } from '@prisma/client';
import { prisma } from '@/server/db';
import { buildAbaFile, headerFromEnv, type AbaLine } from '@/server/integrations/aba';
import { optionalEnv } from '@/server/env';

export type PayRunLineInput = {
  bsb: string;
  account: string;
  amountCents: number;
  reference: string;
  payeeName: string;
  // optional — for audit
  personId?: string;
  billId?: string;
};

/**
 * Build the ABA file text for a pay-run. Doesn't mutate the DB — the caller
 * persists abaFileUrl once the upload lands in SharePoint or similar.
 *
 * Remitter name defaults to "FOUNDRY HEALTH" (<=16 chars). Reference is the
 * string the payee will see on their statement — keep it short.
 */
export function buildPayRunAba(
  lines: PayRunLineInput[],
  opts: {
    description: string;
    processingDate?: Date;
    remitterName?: string;
  },
): string {
  if (lines.length === 0) throw new Error('No pay-run lines to export.');
  const processingDate = opts.processingDate ?? new Date();
  const header = headerFromEnv(opts.description, processingDate);
  const remitter = opts.remitterName ?? optionalEnv('ABA_REMITTER_NAME') ?? 'FOUNDRY HEALTH';

  const abaLines: AbaLine[] = lines.map((l) => ({
    bsb: l.bsb,
    account: l.account,
    amountCents: l.amountCents,
    reference: l.reference.slice(0, 18),
    payeeName: l.payeeName.slice(0, 32),
    remitterName: remitter.slice(0, 16),
  }));
  return buildAbaFile(header, abaLines);
}

/**
 * Convenience: build an ABA file from an existing PayRun row. Reads the
 * PayRunLine rows + joined Person bank details (BSB/acc) where personId is
 * set, otherwise falls back to the PayRunLine's own bsb/acc (e.g. supplier).
 *
 * Decrypts banking PII via the caller — see server/crypto.ts. For now we
 * assume bsb/acc on PayRunLine are plaintext (or already decrypted).
 */
export async function buildAbaForPayRun(payRunId: string): Promise<{
  filename: string;
  content: string;
  totalCents: number;
  lineCount: number;
}> {
  const payRun = await prisma.payRun.findUnique({
    where: { id: payRunId },
    include: {
      lineItems: true,
      bills: {
        where: { abaBatchId: payRunId },
        select: {
          id: true,
          amountTotal: true,
          supplierName: true,
          supplierInvoiceNumber: true,
        },
      },
    },
  });
  if (!payRun) throw new Error(`PayRun ${payRunId} not found`);
  if (payRun.lineItems.length === 0) {
    throw new Error('PayRun has no line items to export.');
  }

  const lines: PayRunLineInput[] = payRun.lineItems.map((l) => ({
    bsb: l.bsb,
    account: l.acc,
    amountCents: l.amount,
    reference: l.reference,
    payeeName: l.reference, // placeholder — real payee name comes from joined data
    ...(l.personId ? { personId: l.personId } : {}),
    ...(l.billId ? { billId: l.billId } : {}),
  }));

  const processingDate = payRun.approvedAt ?? new Date();
  const type: PayRunType = payRun.type;
  const content = buildPayRunAba(lines, {
    description: type === 'payroll' ? 'PAYROLL' : 'AP BATCH',
    processingDate,
  });
  const totalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const ymd = processingDate.toISOString().slice(0, 10);
  const filename = `foundry-${type.toLowerCase()}-${ymd}.aba`;
  return { filename, content, totalCents, lineCount: lines.length };
}
