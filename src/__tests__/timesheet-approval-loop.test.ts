import { describe, it, expect } from 'vitest';
import { partitionDecisionBatch } from '@/server/timesheet';
import {
  buildTimesheetDecisionWhatsApp,
  buildTimesheetApprovalQueueWhatsApp,
} from '@/server/integrations/whatsapp-prompts';

const BASE = 'https://ops.foundry.health';

function entry(
  id: string,
  status: 'draft' | 'submitted' | 'approved' | 'billed',
  personId = 'p1',
) {
  return { id, personId, status };
}

describe('partitionDecisionBatch', () => {
  it('moves the submitted rows and parks the rest', () => {
    const found = [
      entry('a', 'submitted'),
      entry('b', 'approved'),
      entry('c', 'submitted'),
      entry('d', 'billed'),
    ];
    const p = partitionDecisionBatch(['a', 'b', 'c', 'd'], found);
    expect(p.decidable.map((e) => e.id)).toEqual(['a', 'c']);
    expect(p.alreadyDecided.map((e) => e.id)).toEqual(['b', 'd']);
    expect(p.missingCount).toBe(0);
  });

  it('does not abandon the batch when one id went stale (the stuck-queue bug)', () => {
    // The approver's page was rendered before someone recalled entry `b`.
    // Old behaviour: the whole decision failed and both rows stayed in
    // the queue. New behaviour: `a` still gets approved.
    const p = partitionDecisionBatch(['a', 'b'], [entry('a', 'submitted')]);
    expect(p.decidable.map((e) => e.id)).toEqual(['a']);
    expect(p.missingCount).toBe(1);
  });

  it('reports an all-stale batch as nothing-to-decide, not an error case', () => {
    const p = partitionDecisionBatch(['a', 'b'], [entry('a', 'approved'), entry('b', 'approved')]);
    expect(p.decidable).toHaveLength(0);
    expect(p.alreadyDecided).toHaveLength(2);
  });

  it('ignores duplicate ids when counting what is missing', () => {
    const p = partitionDecisionBatch(['a', 'a'], [entry('a', 'submitted')]);
    expect(p.missingCount).toBe(0);
  });
});

describe('buildTimesheetDecisionWhatsApp', () => {
  it('tells an approved submitter who approved it and what it did', () => {
    const msg = buildTimesheetDecisionWhatsApp({
      firstName: 'Rachael',
      decision: 'approved',
      entryCount: 5,
      totalHours: 38,
      approverName: 'Trung Truong',
      appBaseUrl: BASE,
    });
    expect(msg).toContain('Rachael');
    expect(msg).toContain('approved');
    expect(msg).toContain('Trung Truong');
    expect(msg).toContain('5 entries');
    expect(msg).toContain('38.0h');
    expect(msg).toContain(`${BASE}/timesheet`);
  });

  it('singularises a one-entry decision', () => {
    const msg = buildTimesheetDecisionWhatsApp({
      firstName: 'Jas',
      decision: 'approved',
      entryCount: 1,
      totalHours: 7.5,
      approverName: 'Michael',
      appBaseUrl: BASE,
    });
    expect(msg).toContain('1 entry');
    expect(msg).not.toContain('1 entries');
  });

  it('leads a send-back with the reason so it is actionable', () => {
    const msg = buildTimesheetDecisionWhatsApp({
      firstName: 'Jas',
      decision: 'rejected',
      entryCount: 2,
      totalHours: 12,
      approverName: 'Trung Truong',
      note: 'IFM001 hours belong on FHB000',
      appBaseUrl: BASE,
    });
    expect(msg).toContain('Reason: IFM001 hours belong on FHB000');
    expect(msg).toContain('resubmit');
    expect(msg).not.toContain('approved');
  });

  it('omits the note line when the approver left none', () => {
    const msg = buildTimesheetDecisionWhatsApp({
      firstName: 'Jas',
      decision: 'approved',
      entryCount: 1,
      totalHours: 8,
      approverName: 'Chris',
      note: null,
      appBaseUrl: BASE,
    });
    expect(msg).not.toContain('Note:');
  });
});

describe('buildTimesheetApprovalQueueWhatsApp', () => {
  const msg = buildTimesheetApprovalQueueWhatsApp({
    firstName: 'Trung',
    submitterName: 'Rachael Spooner',
    entryCount: 5,
    totalHours: 38,
    weekLabel: '17/08/2026',
    appBaseUrl: BASE,
  });

  it('names the submitter, the volume, and the week', () => {
    expect(msg).toContain('Rachael Spooner');
    expect(msg).toContain('5 entries');
    expect(msg).toContain('38.0h');
    expect(msg).toContain('17/08/2026');
  });

  it('deep-links to the queue where the decision is made', () => {
    expect(msg).toContain(`${BASE}/timesheet/approve`);
  });
});
