import { describe, it, expect } from 'vitest';
import {
  feedbackLane,
  isTerminalFeedbackStatus,
} from '@/server/feedback';
import type { FeedbackStatus } from '@prisma/client';

describe('isTerminalFeedbackStatus', () => {
  it('treats resolved/declined/duplicate as terminal, others as not', () => {
    expect(isTerminalFeedbackStatus('resolved')).toBe(true);
    expect(isTerminalFeedbackStatus('declined')).toBe(true);
    expect(isTerminalFeedbackStatus('duplicate')).toBe(true);
    expect(isTerminalFeedbackStatus('open')).toBe(false);
    expect(isTerminalFeedbackStatus('in_progress')).toBe(false);
    expect(isTerminalFeedbackStatus('approved')).toBe(false);
  });
});

describe('feedbackLane', () => {
  const active: FeedbackStatus[] = ['open', 'triaged', 'approved', 'in_progress'];
  const terminal: FeedbackStatus[] = ['resolved', 'declined', 'duplicate'];

  it('in-flight tickets are always active regardless of archivedAt being null', () => {
    for (const s of active) {
      expect(feedbackLane(s, null)).toBe('active');
    }
  });

  it('completed but not archived → ready_to_archive (stays visible)', () => {
    for (const s of terminal) {
      expect(feedbackLane(s, null)).toBe('ready_to_archive');
    }
  });

  it('anything with archivedAt set → archived (even if somehow non-terminal)', () => {
    const when = new Date('2026-07-30T00:00:00.000Z');
    expect(feedbackLane('resolved', when)).toBe('archived');
    // Guard: archivedAt wins so a stray archived+active row never lingers
    // in the active queue.
    expect(feedbackLane('open', when)).toBe('archived');
  });
});
