import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TASK-069f · nightly backup skip-gate. Mocks the audit-log queries and
 * asserts the run/skip decision + that the change count excludes the
 * backup/export actions themselves.
 */

const db = vi.hoisted(() => ({
  auditEvent: { findFirst: vi.fn(), count: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

import { evaluateBackupGate } from '@/server/exports/backup-gate';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('evaluateBackupGate', () => {
  it('runs unconditionally when there is no prior backup', async () => {
    db.auditEvent.findFirst.mockResolvedValue(null);
    const gate = await evaluateBackupGate();
    expect(gate).toEqual({ changed: true, lastBackupAt: null, changeCount: -1 });
    expect(db.auditEvent.count).not.toHaveBeenCalled();
  });

  it('skips when no mutations since the last backup', async () => {
    const at = new Date('2026-07-30T16:00:00Z');
    db.auditEvent.findFirst.mockResolvedValue({ at });
    db.auditEvent.count.mockResolvedValue(0);
    const gate = await evaluateBackupGate();
    expect(gate.changed).toBe(false);
    expect(gate.lastBackupAt).toEqual(at);
  });

  it('runs when there are mutations since the last backup', async () => {
    const at = new Date('2026-07-30T16:00:00Z');
    db.auditEvent.findFirst.mockResolvedValue({ at });
    db.auditEvent.count.mockResolvedValue(3);
    const gate = await evaluateBackupGate();
    expect(gate.changed).toBe(true);
    expect(gate.changeCount).toBe(3);
  });

  it('excludes backup/export/read actions from the change count', async () => {
    db.auditEvent.findFirst.mockResolvedValue({ at: new Date('2026-07-30T16:00:00Z') });
    db.auditEvent.count.mockResolvedValue(0);
    await evaluateBackupGate();
    const where = db.auditEvent.count.mock.calls[0]![0].where as {
      action: { notIn: string[] };
      at: { gt: Date };
    };
    expect(where.action.notIn).toEqual(
      expect.arrayContaining([
        'data_export_generated',
        'ledger_backup_generated',
        'report_workbook_generated',
        'exported',
        'nightly_export_skipped',
      ]),
    );
    // The skip marker must be excluded, else a quiet night's skip row
    // would look like a change on the following night.
    expect(where.action.notIn).toContain('nightly_export_skipped');
  });
});
