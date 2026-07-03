import { describe, it, expect } from 'vitest';
import { classifyIntentKeyword } from '@/server/agents/intent/classify';

describe('classifyIntentKeyword — offline fallback', () => {
  it('matches timesheet phrases', () => {
    expect(classifyIntentKeyword('Log 4 hours on PROJ001 today')).toBe('timesheet');
    expect(classifyIntentKeyword('what hours did I log?')).toBe('timesheet');
    expect(classifyIntentKeyword('My timesheet is broken')).toBe('timesheet');
  });

  it('matches availability phrases', () => {
    expect(classifyIntentKeyword("I'm available 8h next week")).toBe('availability');
    expect(classifyIntentKeyword('forecast next week')).toBe('availability');
  });

  it('matches expense phrases', () => {
    expect(classifyIntentKeyword('submit an expense')).toBe('expense');
    expect(classifyIntentKeyword('receipt for lunch')).toBe('expense');
  });

  it('matches status_check phrases', () => {
    // The order of the cascade is timesheet → ... → status_check, so
    // a phrase that contains 'hours' or 'logged' lands as timesheet.
    // Use a phrase that hits 'status' / 'how many' without those.
    expect(classifyIntentKeyword('status please')).toBe('status_check');
    expect(classifyIntentKeyword('how many entries this week')).toBe('status_check');
  });

  it('matches menu / cancel', () => {
    expect(classifyIntentKeyword('menu')).toBe('menu');
    expect(classifyIntentKeyword('what are my options?')).toBe('menu');
    expect(classifyIntentKeyword('help')).toBe('menu');
    expect(classifyIntentKeyword('cancel')).toBe('cancel');
    expect(classifyIntentKeyword('abort')).toBe('cancel');
  });

  it('matches confirm (reply-to-confirm, TASK-129)', () => {
    expect(classifyIntentKeyword('CONFIRM')).toBe('confirm');
    expect(classifyIntentKeyword('confirm')).toBe('confirm');
    expect(classifyIntentKeyword('yes submit it')).toBe('confirm');
    expect(classifyIntentKeyword('submit')).toBe('confirm');
    expect(classifyIntentKeyword('yes')).toBe('confirm');
    expect(classifyIntentKeyword('yep')).toBe('confirm');
    expect(classifyIntentKeyword('y')).toBe('confirm');
  });

  it('does not let a bare affirmation swallow a real request', () => {
    // "log"/"hours" still win — a confirm affirmation must not shadow them.
    expect(classifyIntentKeyword('yes log 3h on CAC001')).toBe('timesheet');
  });

  it('returns unknown for unrelated text', () => {
    expect(classifyIntentKeyword('what is the weather today')).toBe('unknown');
    expect(classifyIntentKeyword('')).toBe('unknown');
  });
});
