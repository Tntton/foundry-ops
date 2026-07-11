import { describe, it, expect } from 'vitest';
import { buildFeedbackBrief } from '@/server/feedback-brief';

describe('buildFeedbackBrief', () => {
  const base = {
    id: 'ck_123',
    title: 'Timesheet grid resets on tab switch',
    body: 'When I switch from week to month the hours I typed vanish.',
    kind: 'bug',
    urgency: 'urgent',
    contextPath: '/timesheet',
    triageNotes: 'Grid holds hours in local state; month toggle remounts.',
    submitterName: 'Jane Doe',
  };

  it('includes the ticket id, title, screen and body', () => {
    const brief = buildFeedbackBrief(base);
    expect(brief).toContain('ck_123');
    expect(brief).toContain('Timesheet grid resets on tab switch');
    expect(brief).toContain('Screen: /timesheet');
    expect(brief).toContain('the hours I typed vanish');
    expect(brief).toContain('mark ticket ck_123 resolved');
  });

  it('includes triage notes when present', () => {
    expect(buildFeedbackBrief(base)).toContain('Triage notes');
  });

  it('omits the triage-notes and screen lines when absent', () => {
    const brief = buildFeedbackBrief({
      ...base,
      contextPath: null,
      triageNotes: null,
    });
    expect(brief).not.toContain('Screen:');
    expect(brief).not.toContain('Triage notes');
    // Core fields still present.
    expect(brief).toContain('ck_123');
  });
});
