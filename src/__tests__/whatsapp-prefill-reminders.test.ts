import { describe, it, expect } from 'vitest';
import {
  dueReminder,
  reminderMessage,
  extractPrefillTokenFromUrl,
  EARLY_REMINDER_AFTER_SECONDS,
  LAST_CALL_BEFORE_EXPIRY_SECONDS,
  type DispatchReminderState,
} from '@/server/whatsapp-prefill-dispatch';

describe('extractPrefillTokenFromUrl (reply-to-confirm, TASK-129)', () => {
  it('pulls the prefill token from a timesheet link', () => {
    const url =
      'https://ops.foundry.health/timesheet?week=2026-06-29&prefill=abc.def';
    expect(extractPrefillTokenFromUrl(url)).toBe('abc.def');
  });
  it('pulls the prefill token from an expense link', () => {
    expect(
      extractPrefillTokenFromUrl('https://ops.foundry.health/expenses/new?prefill=xyz.123'),
    ).toBe('xyz.123');
  });
  it('returns null when there is no query / prefill param', () => {
    expect(extractPrefillTokenFromUrl('https://ops.foundry.health/timesheet')).toBeNull();
    expect(extractPrefillTokenFromUrl('https://ops.foundry.health/x?week=1')).toBeNull();
  });
});

const SENT = new Date('2026-07-02T00:00:00.000Z');
const EXPIRES = new Date(SENT.getTime() + 24 * 60 * 60 * 1000); // 24h link

function state(over: Partial<DispatchReminderState> = {}): DispatchReminderState {
  return {
    sentAt: SENT,
    expiresAt: EXPIRES,
    completedAt: null,
    earlyReminderAt: null,
    lastCallReminderAt: null,
    ...over,
  };
}

const at = (secondsAfterSent: number) =>
  new Date(SENT.getTime() + secondsAfterSent * 1000);

describe('dueReminder', () => {
  it('nothing right after sending (before the early threshold)', () => {
    expect(dueReminder(state(), at(60))).toBeNull();
  });

  it('early once past the early threshold', () => {
    expect(dueReminder(state(), at(EARLY_REMINDER_AFTER_SECONDS + 1))).toBe(
      'early',
    );
  });

  it('does not repeat early once stamped', () => {
    const s = state({ earlyReminderAt: at(EARLY_REMINDER_AFTER_SECONDS + 1) });
    expect(dueReminder(s, at(EARLY_REMINDER_AFTER_SECONDS + 100))).toBeNull();
  });

  it('last-call once inside the pre-expiry window', () => {
    const lastCallOpens =
      24 * 60 * 60 - LAST_CALL_BEFORE_EXPIRY_SECONDS; // seconds after sent
    expect(dueReminder(state(), at(lastCallOpens + 10))).toBe('lastcall');
  });

  it('last-call takes priority over early when both are unsent and due', () => {
    // Deep in the last-call window, early never sent → last-call wins.
    expect(dueReminder(state(), at(23 * 60 * 60))).toBe('lastcall');
  });

  it('does not repeat last-call once stamped', () => {
    const s = state({ lastCallReminderAt: at(23 * 60 * 60) });
    expect(dueReminder(s, at(23 * 60 * 60 + 100))).toBeNull();
  });

  it('still offers early in the middle window if last-call not yet open', () => {
    // 5h after send: past early, well before the 20h last-call window.
    expect(dueReminder(state(), at(5 * 60 * 60))).toBe('early');
  });

  it('nothing once completed', () => {
    expect(dueReminder(state({ completedAt: at(100) }), at(23 * 60 * 60))).toBeNull();
  });

  it('nothing once expired (link dead)', () => {
    expect(dueReminder(state(), at(24 * 60 * 60 + 1))).toBeNull();
  });
});

describe('reminderMessage', () => {
  it('includes the link and the in-app-browser tip', () => {
    const msg = reminderMessage(
      { kind: 'timesheet', linkUrl: 'https://ops.foundry.health/timesheet?x=1' },
      'early',
    );
    expect(msg).toContain('https://ops.foundry.health/timesheet?x=1');
    expect(msg.toLowerCase()).toContain('browser');
    expect(msg).toContain('timesheet');
  });

  it('last-call copy signals urgency', () => {
    const msg = reminderMessage(
      { kind: 'expense', linkUrl: 'https://x/y' },
      'lastcall',
    );
    expect(msg.toLowerCase()).toContain('last chance');
    expect(msg).toContain('expense');
  });
});
