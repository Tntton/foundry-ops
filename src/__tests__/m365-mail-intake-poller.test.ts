import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks — must be declared before importing the module under test ───

// prisma singleton — every model method returns a mock so we can assert
// what the poller called and what shape it wrote.
const mockPrisma = {
  mailboxPollCursor: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  bill: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  supplier: {
    findFirst: vi.fn(),
  },
  approval: {
    create: vi.fn(),
  },
  auditEvent: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('@/server/db', () => ({ prisma: mockPrisma }));

// graph app-token client — mocked to return a fixture list-messages
// response. The poller doesn't care where the token comes from.
const mockGraph = vi.fn();
vi.mock('@/server/graph', () => ({
  graph: (...args: unknown[]) => mockGraph(...args),
  graphConfigured: () => true,
  GraphError: class GraphError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown) {
      super(`Graph ${status}`);
      this.name = 'GraphError';
      this.status = status;
      this.body = body;
    }
  },
}));

// env: no DISABLE flag by default.
vi.mock('@/server/env', () => ({
  optionalEnv: (k: string) => (k === 'DISABLE_MAIL_INTAKE' ? undefined : 'set'),
  requireEnv: (k: string) => `${k}_VAL`,
}));

// Extractor stubs — return canned confidence per attachment name so we
// can drive the pick-best-attachment path.
const mockExtract = vi.fn();
vi.mock('@/server/agents/intake-ocr/extract', () => ({
  extractIntakeFields: (input: unknown) => mockExtract(input),
}));

// writeAudit + resolveRequiredRole + notifyApprovers — pass through.
vi.mock('@/server/audit', () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/server/approval-policies', () => ({
  resolveRequiredRole: vi.fn().mockResolvedValue('super_admin'),
}));
vi.mock('@/server/user-updates', () => ({
  notifyApproversOfNewApproval: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import AFTER mocks are registered ───────────────────────────────

const { pollMailbox, looksLikeInvoice } = await import(
  '@/server/integrations/m365-mail-intake'
);

// ─── Fixtures ────────────────────────────────────────────────────────

function goodExtraction(overrides: Partial<{
  supplierName: string;
  invoiceNumber: string;
  amount: number;
  confidence: number;
}> = {}) {
  return {
    ok: true as const,
    data: {
      supplierName: overrides.supplierName ?? 'Xero Supplier Pty Ltd',
      supplierAbn: '12345678901',
      invoiceNumber: overrides.invoiceNumber ?? 'INV-2026-042',
      issueDate: '2026-05-28',
      dueDate: '2026-06-11',
      currency: 'AUD',
      amountTotalDollars: overrides.amount ?? 550.0,
      gstDollars: 50.0,
      category: 'software_subscriptions',
      paymentMethod: null,
      notes: null,
      confidence: { overall: overrides.confidence ?? 92 },
    },
  };
}

function candidateMessage(id: string, subject: string, received: string) {
  return {
    id,
    subject,
    from: {
      emailAddress: { address: 'billing@xero-supplier.com' },
    },
    receivedDateTime: received,
    hasAttachments: true,
    categories: [],
    attachments: [
      {
        id: `${id}-att`,
        name: `${id}.pdf`,
        contentType: 'application/pdf',
        size: 100_000,
        isInline: false,
        contentBytes: 'BASE64PLACEHOLDER',
      },
    ],
  };
}

function nonCandidateMessage(id: string) {
  return {
    id,
    subject: 'Team lunch photos',
    from: { emailAddress: { address: 'friend@gmail.com' } },
    receivedDateTime: '2026-05-29T08:00:00Z',
    hasAttachments: true,
    categories: [],
    attachments: [
      {
        id: `${id}-att`,
        name: 'lunch.jpg',
        contentType: 'image/jpeg',
        size: 50_000,
        isInline: false,
        contentBytes: 'BASE64',
      },
    ],
  };
}

// ─── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default cursor: enabled with a watermark of 2 days ago.
  mockPrisma.mailboxPollCursor.findUnique.mockResolvedValue({
    id: 'cursor-finance',
    mailboxUpn: 'finance@foundry.health',
    enabled: true,
    lastReceivedDateTime: new Date('2026-05-27T00:00:00Z'),
    lastPollAt: new Date('2026-05-29T00:00:00Z'),
    lastError: null,
  });
  mockPrisma.mailboxPollCursor.update.mockResolvedValue({});
  mockPrisma.supplier.findFirst.mockResolvedValue(null); // unmatched vendor path
  mockPrisma.bill.findFirst.mockResolvedValue(null); // no dedupe hit
  mockPrisma.bill.create.mockImplementation(({ data }: { data: { id?: string } }) =>
    Promise.resolve({ ...data, id: 'bill-' + (data.id ?? 'new') }),
  );
  mockPrisma.approval.create.mockResolvedValue({ id: 'appr-1' });
  mockPrisma.auditEvent.create.mockResolvedValue({});
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
    if (typeof fn === 'function') return (fn as (tx: unknown) => Promise<unknown>)(mockPrisma);
    return null;
  });
  mockExtract.mockResolvedValue(goodExtraction());
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────

describe('pollMailbox', () => {
  it('advances the cursor to the newest message receivedDateTime it saw', async () => {
    const messages = [
      candidateMessage('m1', 'Invoice 001', '2026-05-28T10:00:00Z'),
      candidateMessage('m2', 'Invoice 002', '2026-05-29T10:00:00Z'),
    ];
    mockGraph.mockResolvedValueOnce({ value: messages });

    const res = await pollMailbox({
      mailboxUpn: 'finance@foundry.health',
      actorPersonId: 'person-tt',
    });

    expect(res.messagesConsidered).toBe(2);
    // Cursor updated to the newest message, not just the last processed one.
    expect(mockPrisma.mailboxPollCursor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { mailboxUpn: 'finance@foundry.health' },
        data: expect.objectContaining({
          lastReceivedDateTime: new Date('2026-05-29T10:00:00Z'),
          lastError: null,
        }),
      }),
    );
  });

  it('filters non-candidates before spending OCR tokens', async () => {
    const messages = [
      candidateMessage('m1', 'Invoice 001', '2026-05-28T10:00:00Z'),
      nonCandidateMessage('m2'),
    ];
    mockGraph.mockResolvedValueOnce({ value: messages });

    const res = await pollMailbox({
      mailboxUpn: 'finance@foundry.health',
      actorPersonId: 'person-tt',
    });

    expect(res.candidatesScanned).toBe(1);
    // Extractor only called for the invoice message's attachment.
    expect(mockExtract).toHaveBeenCalledTimes(1);
  });

  it('creates a Bill with expected fields for an accepted candidate', async () => {
    mockGraph.mockResolvedValueOnce({
      value: [candidateMessage('m1', 'Invoice #INV-2026-042', '2026-05-28T10:00:00Z')],
    });

    const res = await pollMailbox({
      mailboxUpn: 'finance@foundry.health',
      actorPersonId: 'person-tt',
    });

    expect(res.billsCreated).toBe(1);
    expect(mockPrisma.bill.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountTotal: 55000, // $550.00 → 55000 cents
          gst: 5000,
          status: 'pending_review',
          receivedVia: 'email',
          originalEmailId: 'm1',
          supplierInvoiceNumber: 'INV-2026-042',
          supplierName: 'Xero Supplier Pty Ltd',
          supplierId: null, // unmatched (findFirst returned null)
        }),
      }),
    );
    // Approval + audit rows both written.
    expect(mockPrisma.approval.create).toHaveBeenCalled();
  });

  it('dedupes follow-up reminders by (supplierName + invoiceNumber)', async () => {
    // First fire: 1 bill created. Second fire same invoice number →
    // findFirst returns an existing bill; poller skips creation.
    mockPrisma.bill.findFirst.mockResolvedValueOnce({ id: 'bill-existing' });
    mockGraph.mockResolvedValueOnce({
      value: [
        candidateMessage(
          'm-reminder',
          'Reminder: invoice #INV-2026-042 payment due',
          '2026-05-30T08:00:00Z',
        ),
      ],
    });

    const res = await pollMailbox({
      mailboxUpn: 'finance@foundry.health',
      actorPersonId: 'person-tt',
    });

    expect(res.billsSkippedDuplicate).toBe(1);
    expect(res.billsCreated).toBe(0);
    expect(mockPrisma.bill.create).not.toHaveBeenCalled();
  });

  it('surfaces extraction failure without halting the loop', async () => {
    // Two candidates: first extraction fails, second succeeds. Loop
    // must continue and create the second Bill.
    mockGraph.mockResolvedValueOnce({
      value: [
        candidateMessage('m-fail', 'Invoice A', '2026-05-28T10:00:00Z'),
        candidateMessage('m-ok', 'Invoice B', '2026-05-28T11:00:00Z'),
      ],
    });
    mockExtract
      .mockResolvedValueOnce({ ok: false, reason: 'model outage' })
      .mockResolvedValueOnce(goodExtraction({ invoiceNumber: 'INV-B' }));

    const res = await pollMailbox({
      mailboxUpn: 'finance@foundry.health',
      actorPersonId: 'person-tt',
    });

    expect(res.extractionsFailed).toBe(1);
    expect(res.billsCreated).toBe(1);
    expect(mockPrisma.bill.create).toHaveBeenCalledTimes(1);
  });

  it('skips politely when the cursor row is disabled', async () => {
    mockPrisma.mailboxPollCursor.findUnique.mockResolvedValueOnce({
      id: 'cursor-trung',
      mailboxUpn: 'trung@foundry.health',
      enabled: false,
      lastReceivedDateTime: null,
      lastPollAt: null,
      lastError: null,
    });

    const res = await pollMailbox({
      mailboxUpn: 'trung@foundry.health',
      actorPersonId: 'person-tt',
    });

    expect(res.skippedReason).toBe('cursor disabled');
    expect(mockGraph).not.toHaveBeenCalled();
    expect(mockPrisma.bill.create).not.toHaveBeenCalled();
  });

  it('records lastError and returns without creating rows when Graph errors', async () => {
    mockGraph.mockRejectedValueOnce(
      Object.assign(new Error('Graph 403: forbidden'), {
        name: 'GraphError',
        status: 403,
        body: 'forbidden',
      }),
    );

    const res = await pollMailbox({
      mailboxUpn: 'finance@foundry.health',
      actorPersonId: 'person-tt',
    });

    expect(res.errors.length).toBe(1);
    // Cursor update writes lastError; watermark NOT advanced.
    expect(mockPrisma.mailboxPollCursor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastError: expect.stringContaining('Graph 403'),
        }),
      }),
    );
    const updateCall = mockPrisma.mailboxPollCursor.update.mock.calls[0]![0] as {
      data: { lastReceivedDateTime?: unknown };
    };
    expect(updateCall.data.lastReceivedDateTime).toBeUndefined();
    expect(mockPrisma.bill.create).not.toHaveBeenCalled();
  });
});

// ─── Sanity check that the mocked import still exposes the heuristic ───

describe('looksLikeInvoice (re-export sanity)', () => {
  it('still works through the mocked module', () => {
    const msg = candidateMessage('m1', 'Invoice from vendor', '2026-05-28T10:00:00Z');
    expect(looksLikeInvoice(msg)).toEqual({ ok: true });
  });
});
