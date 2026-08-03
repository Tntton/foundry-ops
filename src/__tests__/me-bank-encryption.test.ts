process.env.AUTH_SECRET ??= 'test-secret-do-not-use-in-prod';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decryptText } from '@/server/crypto';

/**
 * Regression guard: the self-service /me bank form must encrypt BSB +
 * account at rest (it previously wrote plaintext, which both leaked PII
 * and broke payroll's decryptText read). Mocks the I/O and asserts the
 * persisted values are ciphertext that decrypts back to the input.
 */

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  writeAudit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/server/session', () => ({ getSession: mocks.getSession }));
vi.mock('@/server/db', () => ({
  prisma: {
    person: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/server/audit', () => ({ writeAudit: mocks.writeAudit }));

import { updateOwnBankDetails } from '@/app/(app)/me/actions';

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ person: { id: 'p1' } });
  mocks.findUnique.mockResolvedValue({ id: 'p1', bankCountry: 'AU' });
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ person: { update: mocks.update } }),
  );
});

describe('updateOwnBankDetails', () => {
  it('encrypts BSB + account at rest', async () => {
    const res = await updateOwnBankDetails(
      { status: 'idle' },
      fd({ bankCountry: 'AU', bankAccountName: 'Jas', bankBsb: '062-000', bankAcc: '12345678' }),
    );
    expect(res.status).toBe('success');

    const data = mocks.update.mock.calls[0]![0].data as Record<string, string | null>;
    // Not stored as plaintext…
    expect(data.bankBsb).not.toBe('062000');
    expect(data.bankAcc).not.toBe('12345678');
    // …but decrypts back to the entered digits (BSB normalised, dashes stripped).
    expect(decryptText(data.bankBsb as string)).toBe('062000');
    expect(decryptText(data.bankAcc as string)).toBe('12345678');
  });

  it('stores null (not an encrypted empty) when bank fields are blank', async () => {
    const res = await updateOwnBankDetails(
      { status: 'idle' },
      fd({ bankCountry: 'AU', bankAccountName: '', bankBsb: '', bankAcc: '' }),
    );
    expect(res.status).toBe('success');
    const data = mocks.update.mock.calls[0]![0].data as Record<string, string | null>;
    expect(data.bankBsb).toBeNull();
    expect(data.bankAcc).toBeNull();
  });
});
