import { describe, it, expect } from 'vitest';
import { buildCriticalFeedbackWhatsApp } from '@/server/feedback';

describe('buildCriticalFeedbackWhatsApp', () => {
  const msg = buildCriticalFeedbackWhatsApp({
    title: 'Payroll export drops the last employee',
    kind: 'bug',
    submitterName: 'Rachael Spooner',
    appBaseUrl: 'https://ops.foundry.health',
  });

  it('flags the ticket as critical and action-needed', () => {
    expect(msg).toContain('CRITICAL');
    expect(msg.toLowerCase()).toContain('action');
  });

  it('carries the ticket title, kind, and submitter', () => {
    expect(msg).toContain('Payroll export drops the last employee');
    expect(msg).toContain('bug');
    expect(msg).toContain('Rachael Spooner');
  });

  it('deep-links to the triage surface where the decision is made', () => {
    expect(msg).toContain('https://ops.foundry.health/admin/feedback');
  });

  it('stays short enough for a phone screen (single message)', () => {
    // Four lines: header, title, meta, link — no essay.
    expect(msg.split('\n')).toHaveLength(4);
  });
});
