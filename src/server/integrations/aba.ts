/**
 * ABA (Cemtext / Direct Entry) file generator — Australian Banking Association
 * standard used by CBA, NAB, WBC, ANZ etc. for batched multi-debit direct
 * credits.
 *
 * Every line is exactly 120 chars + CRLF. File has:
 *   - 1× Descriptive (Header) record — "0"
 *   - N× Detail records — "1"
 *   - 1× File Total (Trailer) record — "7"
 *
 * Spec reference: NAB "ABA File Format" PDF, CBA "Direct Entry User Guide".
 * Foundry uses CBA so this is formatted to their conventions (bank = "CBA",
 * user = "FOUNDRY HEALTH" — override via env).
 *
 * This module is pure (no DB / Prisma) so it's easy to test and reuse.
 */

import { requireEnv, optionalEnv } from '@/server/env';

export type AbaHeader = {
  bsb: string; // "062-000" style — Foundry's source account
  account: string; // 1-9 digits, right-justified
  userIdentificationNumber: string; // APCA user id, 6 digits, from bank
  userName: string; // e.g. "FOUNDRY HEALTH"
  bankAbbreviation?: string; // "CBA", "NAB" etc. Default CBA for Foundry.
  processingDateDdMmYy: string; // "DDMMYY"
  description?: string; // e.g. "PAY RUN"
};

export type AbaLine = {
  bsb: string; // destination
  account: string; // destination
  amountCents: number; // always positive
  transactionCode?: string; // "50" = credit (default), "13" = debit
  reference: string; // on the payee's statement, max 18 chars
  payeeName: string; // max 32 chars
  remitterName: string; // max 16 chars — who the payment is from (Foundry)
};

const LINE_LENGTH = 120;
const CRLF = '\r\n';

function pad(
  value: string,
  length: number,
  kind: 'left' | 'right' = 'left',
  char: string = ' ',
): string {
  const s = value ?? '';
  if (s.length >= length) return s.slice(0, length);
  const fill = char.repeat(length - s.length);
  return kind === 'left' ? s + fill : fill + s;
}

function normaliseBsb(bsb: string): string {
  // Accept "062000", "062-000", "062 000"; output "062-000".
  const digits = bsb.replace(/\D/g, '');
  if (digits.length !== 6) {
    throw new Error(`Invalid BSB (need 6 digits): ${bsb}`);
  }
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

function normaliseAccount(acc: string): string {
  const digits = acc.replace(/\D/g, '');
  if (digits.length === 0 || digits.length > 9) {
    throw new Error(`Invalid account number: ${acc}`);
  }
  // CBA direct-entry spec: right-justified, zero-filled to 9 chars.
  return pad(digits, 9, 'right', '0');
}

export function buildHeader(h: AbaHeader): string {
  let line = '0'; // record type
  line += pad('', 17, 'left'); // blank
  line += pad('01', 2, 'left'); // reel sequence
  line += pad(h.bankAbbreviation ?? 'CBA', 3, 'left'); // bank abbreviation
  line += pad('', 7, 'left'); // blank
  line += pad(h.userName.toUpperCase(), 26, 'left');
  line += pad(h.userIdentificationNumber.replace(/\D/g, ''), 6, 'right', '0');
  line += pad((h.description ?? 'PAYMENT').toUpperCase(), 12, 'left');
  // Processing date DDMMYY
  if (!/^\d{6}$/.test(h.processingDateDdMmYy)) {
    throw new Error(`Invalid processing date (need DDMMYY): ${h.processingDateDdMmYy}`);
  }
  line += h.processingDateDdMmYy;
  line += pad('', 40, 'left'); // blank
  if (line.length !== LINE_LENGTH) {
    throw new Error(`ABA header length ${line.length} != ${LINE_LENGTH}`);
  }
  return line;
}

export function buildDetail(d: AbaLine): string {
  let line = '1'; // record type
  line += normaliseBsb(d.bsb);
  line += normaliseAccount(d.account);
  line += ' '; // withholding tax indicator — blank
  line += pad((d.transactionCode ?? '50'), 2, 'left'); // 50 = credit
  line += pad(String(d.amountCents), 10, 'right', '0'); // amount in cents
  line += pad(d.payeeName.toUpperCase(), 32, 'left');
  line += pad((d.reference || '').toUpperCase(), 18, 'left');
  // Source BSB / account (bank-system use) — left blank per CBA guide.
  line += pad('', 7, 'left');
  line += pad('', 9, 'left');
  line += pad(d.remitterName.toUpperCase(), 16, 'left');
  line += pad('00000000', 8, 'left'); // withholding tax amount — 0 for us
  if (line.length !== LINE_LENGTH) {
    throw new Error(`ABA detail length ${line.length} != ${LINE_LENGTH}`);
  }
  return line;
}

export function buildTrailer(total: number, lineCount: number): string {
  let line = '7';
  line += '999-999'; // fixed BSB filler
  line += pad('', 12, 'left'); // blank
  line += pad(String(total), 10, 'right', '0'); // net = total (credits only)
  line += pad(String(total), 10, 'right', '0'); // credit total
  line += pad('0', 10, 'right', '0'); // debit total
  line += pad('', 24, 'left'); // blank
  line += pad(String(lineCount), 6, 'right', '0'); // number of detail records
  line += pad('', 40, 'left');
  if (line.length !== LINE_LENGTH) {
    throw new Error(`ABA trailer length ${line.length} != ${LINE_LENGTH}`);
  }
  return line;
}

/**
 * Build a full ABA file from a header spec and N detail lines. Amounts must
 * be in cents; the generator sums them for the trailer.
 */
export function buildAbaFile(header: AbaHeader, lines: AbaLine[]): string {
  if (lines.length === 0) {
    throw new Error('Cannot build an empty ABA file — need at least one detail line.');
  }
  const total = lines.reduce((s, l) => s + l.amountCents, 0);
  const parts = [buildHeader(header), ...lines.map(buildDetail), buildTrailer(total, lines.length)];
  return parts.join(CRLF) + CRLF;
}

/**
 * Convenience: build a header from env (Foundry's source bank details) +
 * today's date, with caller providing only description.
 *
 * Requires the following env vars (all blank by default, fail at runtime):
 *   ABA_USER_BSB           — source BSB (Foundry's CBA account)
 *   ABA_USER_ACCOUNT       — source account number
 *   ABA_USER_ID            — 6-digit APCA user id from CBA
 *   ABA_USER_NAME          — e.g. "FOUNDRY HEALTH PTY LTD"
 *   ABA_BANK_ABBREV        — default "CBA"
 */
export function headerFromEnv(description: string, processingDate: Date): AbaHeader {
  const dd = String(processingDate.getUTCDate()).padStart(2, '0');
  const mm = String(processingDate.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(processingDate.getUTCFullYear() % 100).padStart(2, '0');
  return {
    bsb: requireEnv('ABA_USER_BSB'),
    account: requireEnv('ABA_USER_ACCOUNT'),
    userIdentificationNumber: requireEnv('ABA_USER_ID'),
    userName: requireEnv('ABA_USER_NAME'),
    bankAbbreviation: optionalEnv('ABA_BANK_ABBREV') ?? 'CBA',
    processingDateDdMmYy: `${dd}${mm}${yy}`,
    description,
  };
}
